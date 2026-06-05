import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import {
  createAssociatedTokenAccountInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("hkRnTeBdGovUyhC9TCvJjpkaQn7DWxo6YxhhAZ7Avai");
const USDC_DECIMALS = 6;
const INITIAL_USDC_AMOUNT = 1_000_000_000;
const WRAP_100_USDC = 100_000_000;
const WRAP_50_USDC = 50_000_000;
const HUGE_UNWRAP_AMOUNT = 1_000_000_000_000;

type VaultAccount = {
  admin: PublicKey;
  underlyingMint: PublicKey;
  stedeMint: PublicKey;
  tokenVault: PublicKey;
  lockedAmount: BN;
  paused: boolean;
  bump: number;
};

type VaultFixture = {
  underlyingMint: PublicKey;
  vaultPda: PublicKey;
  stedeMint: Keypair;
  tokenVault: Keypair;
  userUnderlyingAta?: PublicKey;
  userStedeAta?: PublicKey;
};

describe("stede_vault", function () {
  this.timeout(60_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const payer = wallet.payer;
  const user = payer.publicKey;

  let program: Program;
  let sharedFixture: VaultFixture;

  before(async function () {
    program = await Program.at(PROGRAM_ID.toBase58(), provider);

    // Shared wrap/unwrap fixture: one fresh mock USDC mint and one vault PDA.
    sharedFixture = await createVaultFixture({ fundUser: true });
  });

  async function confirmTx(signature: string, label: string): Promise<void> {
    console.log(`${label} transaction: ${signature}`);
    await provider.connection.confirmTransaction(signature, "confirmed");
  }

  async function createVaultFixture(options: {
    fundUser: boolean;
  }): Promise<VaultFixture> {
    const underlyingMintKeypair = Keypair.generate();
    const underlyingMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      USDC_DECIMALS,
      underlyingMintKeypair,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log(`Mock USDC mint: ${underlyingMint.toBase58()}`);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), underlyingMint.toBuffer()],
      PROGRAM_ID
    );

    const fixture: VaultFixture = {
      underlyingMint,
      vaultPda,
      stedeMint: Keypair.generate(),
      tokenVault: Keypair.generate(),
    };

    if (options.fundUser) {
      const userUnderlyingAta = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        underlyingMint,
        user,
        false,
        "confirmed",
        undefined,
        TOKEN_PROGRAM_ID
      );
      fixture.userUnderlyingAta = userUnderlyingAta.address;

      const mintTx = await mintTo(
        connection,
        payer,
        underlyingMint,
        userUnderlyingAta.address,
        payer,
        INITIAL_USDC_AMOUNT,
        [],
        undefined,
        TOKEN_PROGRAM_ID
      );
      await confirmTx(mintTx, "Mint mock USDC");
    }

    return fixture;
  }

  async function initializeVault(
    fixture: VaultFixture,
    label = "Initialize vault"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .initializeVault("Stede USD", "stUSD", "")
      .accounts({
        admin: user,
        underlyingMint: fixture.underlyingMint,
        vault: fixture.vaultPda,
        stedeMint: fixture.stedeMint.publicKey,
        tokenVault: fixture.tokenVault.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        underlyingTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([fixture.stedeMint, fixture.tokenVault])
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function createUserStedeAta(fixture: VaultFixture): Promise<PublicKey> {
    const userStedeAta = getAssociatedTokenAddressSync(
      fixture.stedeMint.publicKey,
      user,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      userStedeAta,
      user,
      fixture.stedeMint.publicKey,
      TOKEN_2022_PROGRAM_ID
    );
    const tx = await provider.sendAndConfirm(
      new Transaction().add(createAtaIx),
      [],
      { commitment: "confirmed" }
    );
    await confirmTx(tx, "Create user Stede ATA");

    fixture.userStedeAta = userStedeAta;
    return userStedeAta;
  }

  async function fetchVault(vaultPda: PublicKey): Promise<VaultAccount> {
    return (program.account as any).vault.fetch(vaultPda);
  }

  async function getTokenAmount(
    tokenAccount: PublicKey,
    tokenProgram: PublicKey
  ): Promise<bigint> {
    const account = await getAccount(
      connection,
      tokenAccount,
      "confirmed",
      tokenProgram
    );
    return account.amount;
  }

  function expectTokenAmount(actual: bigint, expected: number): void {
    expect(actual.toString()).to.equal(expected.toString());
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
    let rejected = false;

    try {
      await action();
    } catch (err) {
      rejected = true;
      console.log(`Expected rejection: ${String(err)}`);
    }

    expect(rejected).to.equal(true);
  }

  async function wrap(
    fixture: VaultFixture,
    amount: number,
    label = "Wrap"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .wrap(new BN(amount))
      .accounts({
        user,
        vault: fixture.vaultPda,
        underlyingMint: fixture.underlyingMint,
        stedeMint: fixture.stedeMint.publicKey,
        tokenVault: fixture.tokenVault.publicKey,
        userUnderlyingAta: fixture.userUnderlyingAta,
        userStedeAta: fixture.userStedeAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        underlyingTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function unwrap(
    fixture: VaultFixture,
    amount: number,
    label = "Unwrap"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .unwrap(new BN(amount))
      .accounts({
        user,
        vault: fixture.vaultPda,
        underlyingMint: fixture.underlyingMint,
        stedeMint: fixture.stedeMint.publicKey,
        tokenVault: fixture.tokenVault.publicKey,
        userStedeAta: fixture.userStedeAta,
        userUnderlyingAta: fixture.userUnderlyingAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        underlyingTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  async function setPaused(
    fixture: VaultFixture,
    paused: boolean,
    admin: Keypair = payer,
    label = "Set paused"
  ): Promise<string> {
    const tx = await (program.methods as any)
      .setPaused(paused)
      .accounts({
        admin: admin.publicKey,
        vault: fixture.vaultPda,
      })
      .signers(admin === payer ? [] : [admin])
      .rpc();

    await confirmTx(tx, label);
    return tx;
  }

  // initialize_vault creates a PDA-backed vault and rejects duplicate vaults.
  describe("initialize_vault", function () {
    let initializeFixture: VaultFixture;

    before(async function () {
      initializeFixture = await createVaultFixture({ fundUser: false });
    });

    it("creates a vault PDA for a new mint", async function () {
      await initializeVault(initializeFixture);

      const vault = await fetchVault(initializeFixture.vaultPda);
      expect(vault.admin.equals(payer.publicKey)).to.equal(true);
      expect(
        vault.underlyingMint.equals(initializeFixture.underlyingMint)
      ).to.equal(true);
      expect(vault.lockedAmount.eq(new BN(0))).to.equal(true);
      expect(vault.paused).to.equal(false);
    });

    it("cannot be initialized twice for the same mint", async function () {
      await expectRejected(async () => {
        await initializeVault({
          ...initializeFixture,
          stedeMint: Keypair.generate(),
          tokenVault: Keypair.generate(),
        });
      });
    });
  });

  // wrap locks classic SPL Token USDC and mints matching Token-2022 Stede USDC.
  describe("wrap", function () {
    before(async function () {
      await initializeVault(sharedFixture, "Initialize shared wrap vault");
      await createUserStedeAta(sharedFixture);
    });

    it("wraps 100 USDC into 100 Stede USDC", async function () {
      await wrap(sharedFixture, WRAP_100_USDC, "Wrap 100 USDC");

      const vault = await fetchVault(sharedFixture.vaultPda);
      const userStedeBalance = await getTokenAmount(
        sharedFixture.userStedeAta!,
        TOKEN_2022_PROGRAM_ID
      );
      const tokenVaultBalance = await getTokenAmount(
        sharedFixture.tokenVault.publicKey,
        TOKEN_PROGRAM_ID
      );

      expect(vault.lockedAmount.eq(new BN(WRAP_100_USDC))).to.equal(true);
      expectTokenAmount(userStedeBalance, WRAP_100_USDC);
      expectTokenAmount(tokenVaultBalance, WRAP_100_USDC);
    });

    it("wraps a second time, accumulating", async function () {
      await wrap(sharedFixture, WRAP_50_USDC, "Wrap 50 USDC");

      const vault = await fetchVault(sharedFixture.vaultPda);
      expect(
        vault.lockedAmount.eq(new BN(WRAP_100_USDC + WRAP_50_USDC))
      ).to.equal(true);
    });

    it("rejects zero amount wrap", async function () {
      await expectAnchorError(
        () => wrap(sharedFixture, 0, "Wrap zero USDC"),
        "ZeroAmount",
        6001
      );
    });

    it("rejects wrap when paused", async function () {
      await setPaused(sharedFixture, true, payer, "Pause shared vault");
      try {
        await expectAnchorError(
          () => wrap(sharedFixture, WRAP_50_USDC, "Wrap while paused"),
          "Paused",
          6000
        );
      } finally {
        await setPaused(sharedFixture, false, payer, "Unpause shared vault");
      }
    });
  });

  // unwrap burns Token-2022 Stede USDC and releases classic SPL Token USDC.
  describe("unwrap", function () {
    it("unwraps 50 Stede USDC into 50 USDC", async function () {
      const beforeUnderlyingBalance = await getTokenAmount(
        sharedFixture.userUnderlyingAta!,
        TOKEN_PROGRAM_ID
      );

      await unwrap(sharedFixture, WRAP_50_USDC, "Unwrap 50 USDC");

      const vault = await fetchVault(sharedFixture.vaultPda);
      const afterUnderlyingBalance = await getTokenAmount(
        sharedFixture.userUnderlyingAta!,
        TOKEN_PROGRAM_ID
      );

      expect(vault.lockedAmount.eq(new BN(WRAP_100_USDC))).to.equal(true);
      expect(Number(afterUnderlyingBalance - beforeUnderlyingBalance)).to.equal(
        WRAP_50_USDC
      );
    });

    it("rejects zero amount unwrap", async function () {
      await expectAnchorError(
        () => unwrap(sharedFixture, 0, "Unwrap zero USDC"),
        "ZeroAmount",
        6001
      );
    });

    it("rejects unwrap exceeding locked balance", async function () {
      await expectAnchorError(
        () =>
          unwrap(
            sharedFixture,
            HUGE_UNWRAP_AMOUNT,
            "Unwrap more than locked balance"
          ),
        "InsufficientLocked",
        6002
      );
    });

    it("rejects unwrap when paused", async function () {
      await setPaused(sharedFixture, true, payer, "Pause before unwrap");
      try {
        await expectAnchorError(
          () => unwrap(sharedFixture, WRAP_50_USDC, "Unwrap while paused"),
          "Paused",
          6000
        );
      } finally {
        await setPaused(sharedFixture, false, payer, "Unpause after unwrap");
      }
    });
  });

  // set_paused is admin-only; this block uses a fresh vault to avoid state bleed.
  describe("set_paused", function () {
    let pauseFixture: VaultFixture;

    before(async function () {
      pauseFixture = await createVaultFixture({ fundUser: false });
      await initializeVault(pauseFixture, "Initialize pause test vault");
    });

    it("admin can pause and unpause", async function () {
      await setPaused(pauseFixture, true, payer, "Pause fresh vault");
      let vault = await fetchVault(pauseFixture.vaultPda);
      expect(vault.paused).to.equal(true);

      await setPaused(pauseFixture, false, payer, "Unpause fresh vault");
      vault = await fetchVault(pauseFixture.vaultPda);
      expect(vault.paused).to.equal(false);
    });

    it("non-admin cannot pause", async function () {
      const nonAdmin = Keypair.generate();

      // Fund the non-admin from the provider wallet instead of devnet faucet
      // (faucet rate limits cause flaky test failures).
      const fundTx = await provider.sendAndConfirm(
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: nonAdmin.publicKey,
            lamports: 0.05 * LAMPORTS_PER_SOL,
          })
        ),
        [],
        { commitment: "confirmed" }
      );
      await confirmTx(fundTx, "Fund non-admin");

      await expectAnchorError(
        () => setPaused(pauseFixture, true, nonAdmin, "Non-admin pause"),
        "Unauthorized",
        6004
      );
    });
  });
});