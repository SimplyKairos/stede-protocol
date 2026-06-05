import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import {
  createAssociatedTokenAccountInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const SLOW_SEND_PROGRAM_ID = new PublicKey(
  "GWhPqirCmLHiYQdHsPXNzG2YexVR6cXsspps8YhPhaRb"
);

type SlowSendConfigAccount = {
  sender: PublicKey;
  stedeMint: PublicKey;
  delaySeconds: BN;
  bump: number;
};

type SlowSendContactAccount = {
  firstContactAt: BN;
  bump: number;
};

type SlowSendFixture = {
  sender: Keypair;
  stedeMint: PublicKey;
  config: PublicKey;
};

function deriveSlowSendConfigPda(
  sender: PublicKey,
  stedeMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("slow_send_config"), sender.toBuffer(), stedeMint.toBuffer()],
    SLOW_SEND_PROGRAM_ID
  );
  return pda;
}

function deriveSlowSendContactPda(
  sender: PublicKey,
  recipient: PublicKey,
  stedeMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("slow_send_contact"),
      sender.toBuffer(),
      recipient.toBuffer(),
      stedeMint.toBuffer(),
    ],
    SLOW_SEND_PROGRAM_ID
  );
  return pda;
}

describe("stede_rule_new_recipient_delay", function () {
  this.timeout(90_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const payer = wallet.payer;

  let program: Program;
  let destinationMint: PublicKey;

  before(async function () {
    program = await Program.at(SLOW_SEND_PROGRAM_ID.toBase58(), provider);
    destinationMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      6,
      Keypair.generate(),
      undefined,
      TOKEN_PROGRAM_ID
    );
  });

  function createFixture(sender = payer): SlowSendFixture {
    const stedeMint = Keypair.generate().publicKey;
    return {
      sender,
      stedeMint,
      config: deriveSlowSendConfigPda(sender.publicKey, stedeMint),
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

  async function createDestinationTokenAccount(
    owner: PublicKey,
    label = "Create destination token account"
  ): Promise<PublicKey> {
    const destinationToken = getAssociatedTokenAddressSync(
      destinationMint,
      owner,
      false,
      TOKEN_PROGRAM_ID
    );
    const tx = await provider.sendAndConfirm(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          destinationToken,
          owner,
          destinationMint,
          TOKEN_PROGRAM_ID
        )
      ),
      [],
      { commitment: "confirmed" }
    );
    await confirmTx(tx, label);
    return destinationToken;
  }

  async function setSlowSend(
    fixture: SlowSendFixture,
    delaySeconds: BN,
    label = "Set Slow Send"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .setSlowSend(delaySeconds)
      .accountsPartial({
        sender: fixture.sender.publicKey,
        stedeMint: fixture.stedeMint,
        config: fixture.config,
        systemProgram: SystemProgram.programId,
      })
      .signers(signersFor(fixture.sender))
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function disableSlowSend(
    fixture: SlowSendFixture,
    label = "Disable Slow Send"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .disableSlowSend()
      .accountsPartial({
        sender: fixture.sender.publicKey,
        config: fixture.config,
      })
      .signers(signersFor(fixture.sender))
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function registerRecipient(
    fixture: SlowSendFixture,
    recipient: PublicKey,
    label = "Register Slow Send recipient"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .registerRecipient(recipient)
      .accountsPartial({
        sender: fixture.sender.publicKey,
        stedeMint: fixture.stedeMint,
        contact: deriveSlowSendContactPda(
          fixture.sender.publicKey,
          recipient,
          fixture.stedeMint
        ),
        systemProgram: SystemProgram.programId,
      })
      .signers(signersFor(fixture.sender))
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function checkTransfer(
    fixture: SlowSendFixture,
    recipient: PublicKey,
    destinationToken: PublicKey,
    label = "Check Slow Send transfer"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .checkTransfer()
      .accountsPartial({
        config: fixture.config,
        contact: deriveSlowSendContactPda(
          fixture.sender.publicKey,
          recipient,
          fixture.stedeMint
        ),
        destinationToken,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function fetchConfig(
    fixture: SlowSendFixture
  ): Promise<SlowSendConfigAccount> {
    return (program.account as any).slowSendConfig.fetch(fixture.config);
  }

  async function fetchContact(
    fixture: SlowSendFixture,
    recipient: PublicKey
  ): Promise<SlowSendContactAccount> {
    return (program.account as any).slowSendContact.fetch(
      deriveSlowSendContactPda(
        fixture.sender.publicKey,
        recipient,
        fixture.stedeMint
      )
    );
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

  describe("setSlowSend", function () {
    it("creates a config PDA with the delay", async function () {
      const fixture = createFixture();

      await setSlowSend(fixture, new BN(3600));

      const config = await fetchConfig(fixture);
      expect(config.sender.equals(fixture.sender.publicKey)).to.equal(true);
      expect(config.stedeMint.equals(fixture.stedeMint)).to.equal(true);
      expect(config.delaySeconds.eq(new BN(3600))).to.equal(true);
    });

    it("updates the delay", async function () {
      const fixture = createFixture();

      await setSlowSend(fixture, new BN(3600), "Set initial Slow Send");
      await setSlowSend(fixture, new BN(7200), "Update Slow Send");

      const config = await fetchConfig(fixture);
      expect(config.delaySeconds.eq(new BN(7200))).to.equal(true);
    });

    it("rejects zero delay", async function () {
      const fixture = createFixture();

      await expectAnchorError(
        () => setSlowSend(fixture, new BN(0), "Set zero-delay Slow Send"),
        "InvalidDelay",
        6002
      );
    });

    it("rejects delay above 604800s", async function () {
      const fixture = createFixture();

      await expectAnchorError(
        () =>
          setSlowSend(fixture, new BN(604_801), "Set above-maximum Slow Send"),
        "InvalidDelay",
        6002
      );
    });
  });

  describe("registerRecipient", function () {
    it("creates a contact PDA with current timestamp", async function () {
      const fixture = createFixture();
      const recipient = Keypair.generate().publicKey;

      await registerRecipient(fixture, recipient);

      const contact = await fetchContact(fixture, recipient);
      expect(contact.firstContactAt.toNumber()).to.be.greaterThan(0);
    });

    it("rejects double registration", async function () {
      const fixture = createFixture();
      const recipient = Keypair.generate().publicKey;

      await registerRecipient(fixture, recipient, "Register recipient once");

      await expectRejected(() =>
        registerRecipient(fixture, recipient, "Register recipient twice")
      );
    });
  });

  describe("disableSlowSend", function () {
    it("closes the config and refunds rent", async function () {
      const sender = Keypair.generate();
      await fundWallet(sender, 100_000_000, "Fund Slow Send owner");
      const fixture = createFixture(sender);

      await setSlowSend(fixture, new BN(3600));
      const beforeDisableBalance = await connection.getBalance(
        sender.publicKey,
        "confirmed"
      );

      await disableSlowSend(fixture);

      const accountInfo = await connection.getAccountInfo(
        fixture.config,
        "confirmed"
      );
      const afterDisableBalance = await connection.getBalance(
        sender.publicKey,
        "confirmed"
      );
      expect(accountInfo).to.equal(null);
      expect(afterDisableBalance).to.be.greaterThan(beforeDisableBalance);
    });

    it("only owner can disable", async function () {
      const senderA = Keypair.generate();
      const senderB = Keypair.generate();
      await fundWallet(senderA, 100_000_000, "Fund owner A");
      await fundWallet(senderB, 10_000_000, "Fund owner B");
      const fixtureA = createFixture(senderA);

      await setSlowSend(fixtureA, new BN(3600));

      await expectRejected(() =>
        disableSlowSend(
          {
            ...fixtureA,
            sender: senderB,
          },
          "Disable with wrong owner"
        )
      );
    });
  });

  describe("checkTransfer (opt-in + waiting period)", function () {
    it("auto-passes when no config exists", async function () {
      const fixture = createFixture();
      const recipient = Keypair.generate().publicKey;
      const destinationToken = await createDestinationTokenAccount(recipient);

      await checkTransfer(
        fixture,
        recipient,
        destinationToken,
        "Check transfer without Slow Send config"
      );
    });

    it("rejects when config exists but recipient not registered", async function () {
      const fixture = createFixture();
      const recipient = Keypair.generate().publicKey;
      const destinationToken = await createDestinationTokenAccount(recipient);

      await setSlowSend(fixture, new BN(3600));

      await expectAnchorError(
        () =>
          checkTransfer(
            fixture,
            recipient,
            destinationToken,
            "Check unregistered recipient"
          ),
        "RecipientNotRegistered",
        6000
      );
    });

    it("rejects when recipient registered but waiting period active", async function () {
      const fixture = createFixture();
      const recipient = Keypair.generate().publicKey;
      const destinationToken = await createDestinationTokenAccount(recipient);

      await setSlowSend(fixture, new BN(3600));
      await registerRecipient(fixture, recipient);

      await expectAnchorError(
        () =>
          checkTransfer(
            fixture,
            recipient,
            destinationToken,
            "Check recipient during waiting period"
          ),
        "WaitingPeriodActive",
        6001
      );
    });

    it("passes when waiting period has elapsed", async function () {
      const fixture = createFixture();
      const recipient = Keypair.generate().publicKey;
      const destinationToken = await createDestinationTokenAccount(recipient);

      await setSlowSend(fixture, new BN(2));
      await registerRecipient(fixture, recipient);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      await checkTransfer(
        fixture,
        recipient,
        destinationToken,
        "Check recipient after waiting period"
      );
    });
  });
});
