import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const TIME_WINDOW_PROGRAM_ID = new PublicKey(
  "8AEdTE3avK5jhVy8osXHfZYnvtn73SSVrRxwuTaytaGu"
);
const TIME_WINDOW_SEED = "time_window";

type TimeWindowFixture = {
  sender: Keypair;
  stedeMint: PublicKey;
  config: PublicKey;
};

describe("stede_rule_time_window", function () {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const payer = wallet.payer;

  let program: Program;

  before(async function () {
    program = await Program.at(TIME_WINDOW_PROGRAM_ID.toBase58(), provider);
  });

  function deriveTimeWindowPda(
    sender: PublicKey,
    stedeMint: PublicKey
  ): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from(TIME_WINDOW_SEED), sender.toBuffer(), stedeMint.toBuffer()],
      TIME_WINDOW_PROGRAM_ID
    );
    return pda;
  }

  function createFixture(sender = payer): TimeWindowFixture {
    const stedeMint = Keypair.generate().publicKey;
    return {
      sender,
      stedeMint,
      config: deriveTimeWindowPda(sender.publicKey, stedeMint),
    };
  }

  async function confirmTx(signature: string, label: string): Promise<void> {
    console.log(`${label} transaction: ${signature}`);
    await connection.confirmTransaction(signature, "confirmed");
  }

  async function setTimeWindow(
    fixture: TimeWindowFixture,
    startHour: number,
    endHour: number,
    label = "Set time window"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .setTimeWindow(startHour, endHour)
      .accountsPartial({
        sender: fixture.sender.publicKey,
        stedeMint: fixture.stedeMint,
        config: fixture.config,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function disableTimeWindow(
    fixture: TimeWindowFixture,
    label = "Disable time window"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .disableTimeWindow()
      .accountsPartial({
        sender: fixture.sender.publicKey,
        config: fixture.config,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function checkTransfer(
    fixture: TimeWindowFixture,
    amount = new BN(1),
    label = "Check time-window transfer"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .checkTransfer(amount)
      .accountsPartial({
        config: fixture.config,
        sender: fixture.sender.publicKey,
        stedeMint: fixture.stedeMint,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  function errorMatches(err: unknown, expectedName: string): boolean {
    const anchorError = err as {
      error?: { errorCode?: { code?: string } };
      message?: string;
      logs?: string[];
    };
    const errorCode = anchorError.error?.errorCode?.code ?? "";
    const message = anchorError.message ?? "";
    const logs = (anchorError.logs ?? []).join("\n");
    const expectedNameLower = expectedName.toLowerCase();

    return (
      errorCode === expectedName ||
      errorCode.toLowerCase() === expectedNameLower ||
      message.includes(expectedName) ||
      message.toLowerCase().includes(expectedNameLower) ||
      logs.includes(expectedName) ||
      logs.toLowerCase().includes(expectedNameLower)
    );
  }

  async function expectAnchorError(
    action: () => Promise<unknown>,
    expectedName: string
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
      errorMatches(caught, expectedName),
      `expected ${expectedName}, got ${String(caught)}`
    ).to.equal(true);
  }

  it("auto-passes when no config exists", async function () {
    this.timeout(90_000);

    const fixture = createFixture();

    await checkTransfer(fixture, new BN(1), "Check without config");
  });

  it("passes outside the blocked time window", async function () {
    this.timeout(90_000);

    const fixture = createFixture();
    const currentHour = new Date().getUTCHours();
    const startHour = (currentHour + 1) % 24;
    const endHour = (currentHour + 2) % 24;

    await setTimeWindow(
      fixture,
      startHour,
      endHour,
      "Set non-current blocked window"
    );
    await checkTransfer(fixture, new BN(1), "Check outside blocked window");
  });

  it("fails inside the blocked time window", async function () {
    this.timeout(90_000);

    const fixture = createFixture();
    const currentHour = new Date().getUTCHours();

    await setTimeWindow(
      fixture,
      currentHour,
      (currentHour + 1) % 24,
      "Set current blocked window"
    );

    await expectAnchorError(
      () =>
        checkTransfer(fixture, new BN(1), "Check inside blocked time window"),
      "WithinBlockedWindow"
    );
  });

  it("fails inside a wraparound blocked time window", async function () {
    this.timeout(90_000);

    const fixture = createFixture();
    const currentHour = new Date().getUTCHours();

    await setTimeWindow(
      fixture,
      (currentHour + 23) % 24,
      (currentHour + 1) % 24,
      "Set wraparound blocked window"
    );

    await expectAnchorError(
      () =>
        checkTransfer(
          fixture,
          new BN(1),
          "Check inside wraparound blocked time window"
        ),
      "WithinBlockedWindow"
    );
  });

  it("auto-passes again after disabling the time window", async function () {
    this.timeout(90_000);

    const fixture = createFixture();
    const currentHour = new Date().getUTCHours();

    await setTimeWindow(
      fixture,
      currentHour,
      (currentHour + 1) % 24,
      "Set time window before disable"
    );
    await disableTimeWindow(fixture);

    const configInfo = await connection.getAccountInfo(
      fixture.config,
      "confirmed"
    );
    expect(configInfo).to.equal(null);

    await checkTransfer(fixture, new BN(1), "Check after disabling");
  });

  it("rejects invalid hours", async function () {
    this.timeout(90_000);

    const fixture = createFixture();

    await expectAnchorError(
      () => setTimeWindow(fixture, 24, 0, "Set invalid start hour"),
      "InvalidHour"
    );
  });
});
