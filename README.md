# Cent Canvas

A crypto pixel canvas where users connect a wallet, claim pixels, and can overtake existing pixels by paying double the previous price.

## Features

- Phantom, Solflare, MetaMask, Trust Wallet, Coinbase Wallet, Rabby, and generic EVM wallet options
- Backend admin login for payment destinations
- Backend-authenticated admin mode for free admin pixel placement and board clearing
- First 50 connected wallets get 5 free first-claim pixels
- $0.10 starting price after free credits
- Multi-pixel batch purchases
- Backend transaction verification for paid Solana/Base/Polygon claims
- Blockchain explorer links for verified paid transactions
- Shared backend claims and leaderboard

## Run Locally

```bash
npm start
```

Open:

```text
http://localhost:8080/
```

Admin panel:

```text
http://localhost:8080/admin.html
```

On first admin visit, create a password with at least 12 characters. Then set payment destinations for Solana, Base, and Polygon.

After logging in at `/admin.html`, the public canvas will also unlock backend admin mode in the same browser. Admin mode can place pixels without payment and clear the board. These actions are rejected by the backend without a valid admin session token.

## Upload To GitHub

```bash
git init
git add .
git commit -m "Initial Cent Canvas app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

Do not upload `.data/`; it is ignored because it contains runtime backend data.

## Deploy On Render

1. Push this repo to GitHub.
2. Create a new Render Web Service.
3. Connect the GitHub repo.
4. Use:
   - Build command: blank
   - Start command: `node server.js`
5. Add environment variables:
   - `ADMIN_PASSWORD`: your admin password, at least 12 characters
   - `SOLANA_PAYMENT_DESTINATION`: your Solana receiving wallet
   - `BASE_PAYMENT_DESTINATION`: your Base receiving wallet
   - `POLYGON_PAYMENT_DESTINATION`: your Polygon receiving wallet
6. Deploy.

The admin panel can still save destinations while the server is running. The environment variables are the durable fallback so the payment wallets come back after a reboot or redeploy.

## Production Notes

Paid claims are verified by the backend before pixels are saved. The server checks the sender wallet, payment destination, amount, confirmation status, and prevents transaction hash reuse.

Optional RPC environment variables:

```text
ADMIN_PASSWORD=use-a-long-private-password
BASE_PAYMENT_DESTINATION=0x...
SOLANA_PAYMENT_DESTINATION=...
POLYGON_PAYMENT_DESTINATION=0x...
BASE_RPC_URL=https://mainnet.base.org
SOLANA_RPC_URL=https://solana-rpc.publicnode.com
POLYGON_RPC_URL=https://polygon-rpc.com
```

For a bigger launch, use paid RPC endpoints instead of public RPCs so verification stays fast under traffic.
