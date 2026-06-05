import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import {
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const FRIEND_GATE_PROGRAM_ID = new PublicKey(
  "C2ETjCNkHYdPzNZxJtufmnc3j5at2osxG6csrS9StNk5"
);
const FRIEND_GATE_SEED = "rule_friend_gate";

type FriendGateAccount = {
  sender: PublicKey;
  stedeMint: PublicKey;
  threshold: BN;
  friendWallet: PublicKey;
  bump: number;
};

type FriendGateFixture = {
  sender: Keypair;
  stedeMint: PublicKey;
  friendGate: PublicKey;
};

function deriveFriendGatePda(
  sender: PublicKey,
  stedeMint: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(FRIEND_GATE_SEED), sender.toBuffer(), stedeMint.toBuffer()],
    FRIEND_GATE_PROGRAM_ID
  );
  return pda;
}

describe("stede_rule_friend_gate", function () {
  this.timeout(90_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const payer = wallet.payer;

  let program: Program;

  before(async function () {
    program = await Program.at(FRIEND_GATE_PROGRAM_ID.toBase58(), provider);
  });

  function createFixture(sender = payer): FriendGateFixture {
    const stedeMint = Keypair.generate().publicKey;
    return {
      sender,
      stedeMint,
      friendGate: deriveFriendGatePda(sender.publicKey, stedeMint),
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

  async function setFriendGate(
    fixture: FriendGateFixture,
    threshold: BN,
    friendWallet: PublicKey,
    label = "Set Friend Gate"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .setFriendGate(threshold, friendWallet)
      .accountsPartial({
        sender: fixture.sender.publicKey,
        stedeMint: fixture.stedeMint,
        friendGate: fixture.friendGate,
        systemProgram: SystemProgram.programId,
      })
      .signers(signersFor(fixture.sender))
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function disableFriendGate(
    fixture: FriendGateFixture,
    label = "Disable Friend Gate"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .disableFriendGate()
      .accountsPartial({
        sender: fixture.sender.publicKey,
        friendGate: fixture.friendGate,
      })
      .signers(signersFor(fixture.sender))
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function checkTransfer(
    fixture: FriendGateFixture,
    amount: BN,
    label = "Check Friend Gate transfer"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .checkTransfer(amount)
      .accountsPartial({
        friendGate: fixture.friendGate,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function fetchFriendGate(
    fixture: FriendGateFixture
  ): Promise<FriendGateAccount> {
    return (program.account as any).friendGate.fetch(fixture.friendGate);
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

  describe("setFriendGate", function () {
    it("creates a config PDA", async function () {
      const fixture = createFixture();
      const friend = Keypair.generate();

      await setFriendGate(fixture, new BN(1_000_000), friend.publicKey);

      const friendGate = await fetchFriendGate(fixture);
      expect(friendGate.threshold.eq(new BN(1_000_000))).to.equal(true);
      expect(friendGate.friendWallet.equals(friend.publicKey)).to.equal(true);
    });

    it("updates threshold and friend", async function () {
      const fixture = createFixture();
      const friendA = Keypair.generate();
      const friendB = Keypair.generate();

      await setFriendGate(
        fixture,
        new BN(1_000_000),
        friendA.publicKey,
        "Set initial Friend Gate"
      );
      await setFriendGate(
        fixture,
        new BN(2_000_000),
        friendB.publicKey,
        "Update Friend Gate"
      );

      const friendGate = await fetchFriendGate(fixture);
      expect(friendGate.threshold.eq(new BN(2_000_000))).to.equal(true);
      expect(friendGate.friendWallet.equals(friendB.publicKey)).to.equal(true);
    });

    it("rejects zero threshold", async function () {
      const fixture = createFixture();
      const friend = Keypair.generate();

      await expectAnchorError(
        () =>
          setFriendGate(
            fixture,
            new BN(0),
            friend.publicKey,
            "Set zero threshold"
          ),
        "ZeroThreshold",
        6001
      );
    });

    it("rejects zero-address friend", async function () {
      const fixture = createFixture();

      await expectAnchorError(
        () =>
          setFriendGate(
            fixture,
            new BN(1000),
            PublicKey.default,
            "Set zero friend"
          ),
        "ZeroFriend",
        6002
      );
    });

    it("rejects friend == sender", async function () {
      const fixture = createFixture();

      await expectAnchorError(
        () =>
          setFriendGate(
            fixture,
            new BN(1000),
            fixture.sender.publicKey,
            "Set self as friend"
          ),
        "FriendIsSelf",
        6003
      );
    });
  });

  describe("disableFriendGate", function () {
    it("closes config and refunds rent", async function () {
      const sender = Keypair.generate();
      const friend = Keypair.generate();
      await fundWallet(sender, 100_000_000, "Fund Friend Gate owner");
      const fixture = createFixture(sender);

      await setFriendGate(fixture, new BN(1_000_000), friend.publicKey);
      const beforeDisableBalance = await connection.getBalance(
        sender.publicKey,
        "confirmed"
      );

      await disableFriendGate(fixture);

      const accountInfo = await connection.getAccountInfo(
        fixture.friendGate,
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
      const friend = Keypair.generate();
      await fundWallet(senderA, 100_000_000, "Fund owner A");
      await fundWallet(senderB, 10_000_000, "Fund owner B");
      const fixtureA = createFixture(senderA);

      await setFriendGate(fixtureA, new BN(1_000_000), friend.publicKey);

      await expectRejected(() =>
        disableFriendGate(
          {
            ...fixtureA,
            sender: senderB,
          },
          "Disable with wrong owner"
        )
      );
    });
  });

  describe("checkTransfer (direct calls)", function () {
    it("auto-passes when no config exists", async function () {
      const fixture = createFixture();

      await checkTransfer(fixture, new BN(5000), "Check without config");
    });

    it("passes when amount below threshold", async function () {
      const fixture = createFixture();
      const friend = Keypair.generate();

      await setFriendGate(fixture, new BN(1_000_000), friend.publicKey);
      await checkTransfer(fixture, new BN(500_000), "Check below threshold");
    });

    it("rejects when amount >= threshold and friend did NOT sign", async function () {
      const fixture = createFixture();
      const friend = Keypair.generate();

      await setFriendGate(fixture, new BN(1_000_000), friend.publicKey);

      await expectAnchorError(
        () =>
          checkTransfer(
            fixture,
            new BN(2_000_000),
            "Check above threshold without friend"
          ),
        "FriendSignatureRequired",
        6000
      );
    });

    it("passes when amount >= threshold and friend DID sign", async function () {
      const fixture = createFixture();
      const friend = Keypair.generate();
      await fundWallet(friend, 10_000_000, "Fund friend signer");

      await setFriendGate(fixture, new BN(1_000_000), friend.publicKey);

      const carrierIx = SystemProgram.transfer({
        fromPubkey: friend.publicKey,
        toPubkey: friend.publicKey,
        lamports: 0,
      });
      const checkIx = await (program.methods as any)
        .checkTransfer(new BN(2_000_000))
        .accountsPartial({
          friendGate: fixture.friendGate,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .instruction();
      const tx = await provider.sendAndConfirm(
        new Transaction().add(carrierIx, checkIx),
        [friend],
        { commitment: "confirmed" }
      );
      await confirmTx(tx, "Check above threshold with friend");
    });
  });
});
