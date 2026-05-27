import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const DAILY_LIMIT_PROGRAM_ID = new PublicKey(
  "DnNcQGbcGtveExwz16oU9SheonBjADZiaExjC2W3CKi5"
);
const DAILY_LIMIT_SEED = "rule_daily_limit";

type DailyLimitAccount = {
  sender: PublicKey;
  stedeMint: PublicKey;
  limit: BN;
  spentToday: BN;
  windowStartSlot: BN;
  bump: number;
};

type DailyLimitFixture = {
  stedeMint: PublicKey;
  dailyLimit: PublicKey;
};

describe("stede_rule_daily_limit", function () {
  this.timeout(60_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const payer = wallet.payer;

  let program: Program;

  before(async function () {
    program = await Program.at(DAILY_LIMIT_PROGRAM_ID.toBase58(), provider);
  });

  function deriveDailyLimit(
    sender: PublicKey,
    stedeMint: PublicKey
  ): PublicKey {
    const [dailyLimit] = PublicKey.findProgramAddressSync(
      [Buffer.from(DAILY_LIMIT_SEED), sender.toBuffer(), stedeMint.toBuffer()],
      DAILY_LIMIT_PROGRAM_ID
    );
    return dailyLimit;
  }

  function createFixture(): DailyLimitFixture {
    const stedeMint = Keypair.generate().publicKey;
    return {
      stedeMint,
      dailyLimit: deriveDailyLimit(payer.publicKey, stedeMint),
    };
  }

  async function confirmTx(signature: string, label: string): Promise<void> {
    console.log(`${label} transaction: ${signature}`);
    await connection.confirmTransaction(signature, "confirmed");
  }

  async function setLimit(
    fixture: DailyLimitFixture,
    limit: BN,
    label = "Set daily limit"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .setLimit(limit)
      .accounts({
        sender: payer.publicKey,
        stedeMint: fixture.stedeMint,
        dailyLimit: fixture.dailyLimit,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function checkTransfer(
    fixture: DailyLimitFixture,
    amount: BN,
    label = "Check transfer"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .checkTransfer(amount)
      .accounts({
        dailyLimit: fixture.dailyLimit,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function fetchDailyLimit(
    fixture: DailyLimitFixture
  ): Promise<DailyLimitAccount> {
    return (program.account as any).dailyLimit.fetch(fixture.dailyLimit);
  }

  function errorMatches(
    err: unknown,
    expectedName: string,
    expectedCode: number
  ): boolean {
    const anchorError = err as {
      error?: { errorCode?: { code?: string; number?: number } };
      message?: string;
      logs?: string[];
    };
    const errorCode = anchorError.error?.errorCode;
    const message = anchorError.message ?? "";
    const logs = (anchorError.logs ?? []).join("\n");
    const hexCode = `0x${expectedCode.toString(16)}`;

    return (
      errorCode?.code === expectedName ||
      errorCode?.number === expectedCode ||
      message.includes(expectedName) ||
      message.includes(expectedCode.toString()) ||
      message.includes(hexCode) ||
      logs.includes(expectedName) ||
      logs.includes(expectedCode.toString()) ||
      logs.includes(hexCode)
    );
  }

  async function expectAnchorError(
    action: () => Promise<unknown>,
    expectedName: string,
    expectedCode: number
  ): Promise<void> {
    let caught: unknown;

    try {
      await action();
    } catch (err) {
      caught = err;
      console.log(`Expected ${expectedName} rejection: ${String(err)}`);
    }

    expect(caught, `expected ${expectedName} to be thrown`).to.not.equal(
      undefined
    );
    expect(
      errorMatches(caught, expectedName, expectedCode),
      `expected ${expectedName} (${expectedCode}), got ${String(caught)}`
    ).to.equal(true);
  }

  // setLimit creates or updates the sender's per-mint DailyLimit PDA.
  describe("setLimit", function () {
    it("creates a DailyLimit PDA with the configured limit", async function () {
      const fixture = createFixture();

      await setLimit(fixture, new BN(1_000_000), "Set 1 USDC daily limit");

      const dailyLimit = await fetchDailyLimit(fixture);
      expect(dailyLimit.sender.equals(payer.publicKey)).to.equal(true);
      expect(dailyLimit.stedeMint.equals(fixture.stedeMint)).to.equal(true);
      expect(dailyLimit.limit.eq(new BN(1_000_000))).to.equal(true);
      expect(dailyLimit.spentToday.eq(new BN(0))).to.equal(true);
      expect(dailyLimit.windowStartSlot.gt(new BN(0))).to.equal(true);
    });

    it("updates limit without resetting spent_today", async function () {
      const fixture = createFixture();

      await setLimit(fixture, new BN(5_000_000), "Set initial daily limit");
      await setLimit(fixture, new BN(10_000_000), "Update daily limit");

      const dailyLimit = await fetchDailyLimit(fixture);
      expect(dailyLimit.limit.eq(new BN(10_000_000))).to.equal(true);
      expect(dailyLimit.spentToday.eq(new BN(0))).to.equal(true);
    });

    it("rejects zero limit", async function () {
      const fixture = createFixture();

      await expectAnchorError(
        () => setLimit(fixture, new BN(0), "Set zero daily limit"),
        "ZeroLimit",
        6001
      );
    });
  });

  // checkTransfer simulates the hook's CPI into the rule program.
  describe("checkTransfer", function () {
    it("approves a transfer within the limit", async function () {
      const fixture = createFixture();

      await setLimit(fixture, new BN(100), "Set limit 100");
      await checkTransfer(fixture, new BN(40), "Check transfer 40");

      const dailyLimit = await fetchDailyLimit(fixture);
      expect(dailyLimit.spentToday.eq(new BN(40))).to.equal(true);
    });

    it("accumulates spent_today across transfers", async function () {
      const fixture = createFixture();

      await setLimit(fixture, new BN(100), "Set limit for accumulation");
      await checkTransfer(fixture, new BN(40), "Check transfer 40");
      await checkTransfer(fixture, new BN(30), "Check transfer 30");

      const dailyLimit = await fetchDailyLimit(fixture);
      expect(dailyLimit.spentToday.eq(new BN(70))).to.equal(true);
    });

    it("rejects a transfer that would exceed the limit", async function () {
      const fixture = createFixture();

      await setLimit(fixture, new BN(100), "Set limit before exceed check");
      await checkTransfer(fixture, new BN(40), "Check transfer before exceed");

      await expectAnchorError(
        () => checkTransfer(fixture, new BN(70), "Check transfer over limit"),
        "DailyLimitExceeded",
        6000
      );
    });

    it("rejects a single transfer exceeding the limit", async function () {
      const fixture = createFixture();

      await setLimit(fixture, new BN(50), "Set limit below transfer amount");

      await expectAnchorError(
        () =>
          checkTransfer(
            fixture,
            new BN(100),
            "Check single over-limit transfer"
          ),
        "DailyLimitExceeded",
        6000
      );
    });
  });
});
