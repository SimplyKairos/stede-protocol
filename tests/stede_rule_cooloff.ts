import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const COOLOFF_PROGRAM_ID = new PublicKey(
  "4Cc51G1AnduEcwtYQTfUKNVmNnERmrBmUv7mCHRQSSUg"
);
const COOLOFF_SEED = "rule_cooloff";

type CooloffAccount = {
  sender: PublicKey;
  stedeMint: PublicKey;
  threshold: BN;
  durationSeconds: BN;
  lastLargeTransferAt: BN;
  bump: number;
};

type CooloffFixture = {
  sender: Keypair;
  stedeMint: PublicKey;
  cooloff: PublicKey;
};

describe("stede_rule_cooloff", function () {
  this.timeout(60_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const payer = wallet.payer;

  let program: Program;

  before(async function () {
    program = await Program.at(COOLOFF_PROGRAM_ID.toBase58(), provider);
  });

  function deriveCooloffPda(
    sender: PublicKey,
    stedeMint: PublicKey
  ): PublicKey {
    const [cooloff] = PublicKey.findProgramAddressSync(
      [Buffer.from(COOLOFF_SEED), sender.toBuffer(), stedeMint.toBuffer()],
      COOLOFF_PROGRAM_ID
    );
    return cooloff;
  }

  function createFixture(sender = payer): CooloffFixture {
    const stedeMint = Keypair.generate().publicKey;
    return {
      sender,
      stedeMint,
      cooloff: deriveCooloffPda(sender.publicKey, stedeMint),
    };
  }

  function signersFor(sender: Keypair): Keypair[] {
    return sender.publicKey.equals(payer.publicKey) ? [] : [sender];
  }

  async function confirmTx(signature: string, label: string): Promise<void> {
    console.log(`${label} transaction: ${signature}`);
    await connection.confirmTransaction(signature, "confirmed");
  }

  async function fundWallet(
    walletToFund: Keypair,
    lamports: number,
    label: string
  ): Promise<string> {
    const tx = await provider.sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: walletToFund.publicKey,
          lamports,
        })
      ),
      [],
      { commitment: "confirmed" }
    );
    await confirmTx(tx, `${label} ${walletToFund.publicKey.toBase58()}`);
    return tx;
  }

  async function setCooloff(
    fixture: CooloffFixture,
    threshold: BN,
    durationSeconds: BN,
    label = "Set cool-off"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .setCooloff(threshold, durationSeconds)
      .accountsPartial({
        sender: fixture.sender.publicKey,
        stedeMint: fixture.stedeMint,
        cooloff: fixture.cooloff,
        systemProgram: SystemProgram.programId,
      })
      .signers(signersFor(fixture.sender))
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function disableCooloff(
    fixture: CooloffFixture,
    label = "Disable cool-off"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .disableCooloff()
      .accountsPartial({
        sender: fixture.sender.publicKey,
        cooloff: fixture.cooloff,
      })
      .signers(signersFor(fixture.sender))
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function checkTransfer(
    fixture: CooloffFixture,
    amount: BN,
    label = "Check cool-off transfer"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .checkTransfer(amount)
      .accountsPartial({
        cooloff: fixture.cooloff,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function fetchCooloff(
    fixture: CooloffFixture
  ): Promise<CooloffAccount> {
    return (program.account as any).cooloff.fetch(fixture.cooloff);
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
    const expectedNameLower = expectedName.toLowerCase();

    return (
      errorCode?.code === expectedName ||
      errorCode?.code?.toLowerCase() === expectedNameLower ||
      errorCode?.number === expectedCode ||
      message.includes(expectedName) ||
      message.toLowerCase().includes(expectedNameLower) ||
      message.includes(expectedCode.toString()) ||
      message.includes(hexCode) ||
      logs.includes(expectedName) ||
      logs.toLowerCase().includes(expectedNameLower) ||
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

  async function expectRejected(action: () => Promise<unknown>): Promise<void> {
    let caught: unknown;

    try {
      await action();
    } catch (err) {
      caught = err;
      console.log(`Expected rejection: ${String(err)}`);
    }

    expect(caught, "expected action to be rejected").to.not.equal(undefined);
  }

  describe("setCooloff", function () {
    it("creates a Cooloff PDA with threshold and duration", async function () {
      const fixture = createFixture();

      await setCooloff(fixture, new BN(100), new BN(30));

      const cooloff = await fetchCooloff(fixture);
      expect(cooloff.sender.equals(fixture.sender.publicKey)).to.equal(true);
      expect(cooloff.stedeMint.equals(fixture.stedeMint)).to.equal(true);
      expect(cooloff.threshold.eq(new BN(100))).to.equal(true);
      expect(cooloff.durationSeconds.eq(new BN(30))).to.equal(true);
      expect(cooloff.lastLargeTransferAt.eq(new BN(0))).to.equal(true);
    });

    it("updates threshold and duration without resetting last_large_transfer_at", async function () {
      const fixture = createFixture();

      await setCooloff(
        fixture,
        new BN(100),
        new BN(30),
        "Set initial cool-off"
      );
      await checkTransfer(fixture, new BN(150), "Start cool-off timer");
      await setCooloff(fixture, new BN(200), new BN(60), "Update cool-off");

      const cooloff = await fetchCooloff(fixture);
      expect(cooloff.threshold.eq(new BN(200))).to.equal(true);
      expect(cooloff.durationSeconds.eq(new BN(60))).to.equal(true);
      expect(cooloff.lastLargeTransferAt.toNumber()).to.be.greaterThan(0);
    });

    it("rejects zero threshold", async function () {
      const fixture = createFixture();

      await expectAnchorError(
        () => setCooloff(fixture, new BN(0), new BN(30), "Set zero threshold"),
        "ZeroThreshold",
        6001
      );
    });

    it("rejects zero duration", async function () {
      const fixture = createFixture();

      await expectAnchorError(
        () => setCooloff(fixture, new BN(100), new BN(0), "Set zero duration"),
        "InvalidDuration",
        6002
      );
    });

    it("rejects duration over 24 hours", async function () {
      const fixture = createFixture();

      await expectAnchorError(
        () =>
          setCooloff(
            fixture,
            new BN(100),
            new BN(86_401),
            "Set duration over 24h"
          ),
        "InvalidDuration",
        6002
      );
    });
  });

  describe("checkTransfer", function () {
    it("approves small transfers below threshold without setting cool-off", async function () {
      const fixture = createFixture();

      await setCooloff(fixture, new BN(100), new BN(30));
      await checkTransfer(fixture, new BN(50), "Check small transfer");

      const cooloff = await fetchCooloff(fixture);
      expect(cooloff.lastLargeTransferAt.eq(new BN(0))).to.equal(true);
    });

    it("approves a large transfer and starts the cool-off", async function () {
      const fixture = createFixture();

      await setCooloff(fixture, new BN(100), new BN(30));
      await checkTransfer(fixture, new BN(150), "Check first large transfer");

      const cooloff = await fetchCooloff(fixture);
      expect(cooloff.lastLargeTransferAt.toNumber()).to.be.greaterThan(0);
    });

    it("rejects a large transfer during active cool-off", async function () {
      const fixture = createFixture();

      await setCooloff(fixture, new BN(100), new BN(30));
      await checkTransfer(fixture, new BN(150), "Check first large transfer");
      const beforeReject = await fetchCooloff(fixture);

      await expectAnchorError(
        () =>
          checkTransfer(
            fixture,
            new BN(150),
            "Check second large transfer during cool-off"
          ),
        "CooloffActive",
        6000
      );

      const afterReject = await fetchCooloff(fixture);
      expect(
        afterReject.lastLargeTransferAt.eq(beforeReject.lastLargeTransferAt)
      ).to.equal(true);
    });

    it("allows small transfers during active cool-off", async function () {
      const fixture = createFixture();

      await setCooloff(fixture, new BN(100), new BN(30));
      await checkTransfer(fixture, new BN(150), "Check first large transfer");
      await checkTransfer(fixture, new BN(50), "Check small transfer");
    });

    it("allows another large transfer after cool-off duration elapses", async function () {
      const fixture = createFixture();

      await setCooloff(fixture, new BN(100), new BN(2));
      await checkTransfer(fixture, new BN(150), "Check first large transfer");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await checkTransfer(
        fixture,
        new BN(150),
        "Check large transfer after wait"
      );
    });
  });

  describe("disableCooloff", function () {
    it("closes the PDA and refunds rent", async function () {
      const sender = Keypair.generate();
      await fundWallet(sender, 100_000_000, "Fund cool-off owner");
      const fixture = createFixture(sender);

      await setCooloff(fixture, new BN(100), new BN(30));
      const beforeDisableBalance = await connection.getBalance(
        sender.publicKey,
        "confirmed"
      );

      await disableCooloff(fixture);

      const accountInfo = await connection.getAccountInfo(
        fixture.cooloff,
        "confirmed"
      );
      const afterDisableBalance = await connection.getBalance(
        sender.publicKey,
        "confirmed"
      );
      expect(accountInfo).to.equal(null);
      expect(afterDisableBalance).to.be.greaterThan(beforeDisableBalance);
    });

    it("only the owner can disable cooloff", async function () {
      const senderA = Keypair.generate();
      const senderB = Keypair.generate();
      await fundWallet(senderA, 100_000_000, "Fund owner A");
      await fundWallet(senderB, 10_000_000, "Fund owner B");
      const fixtureA = createFixture(senderA);

      await setCooloff(fixtureA, new BN(100), new BN(30));

      const fixtureWithWrongSender = {
        ...fixtureA,
        sender: senderB,
      };
      await expectRejected(() =>
        disableCooloff(fixtureWithWrongSender, "Disable with wrong owner")
      );
    });
  });
});
