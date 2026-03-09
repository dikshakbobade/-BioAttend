# GitHub & Render Deployment Guide

Follow these steps to get a permanent public link for your Biometric Attendance System.

## 1. Create a GitHub Repository
1. Go to [github.com/new](https://github.com/new).
2. Repository name: `biometric-attendance-system`.
3. Select **Private** (recommended for security).
4. Click **Create repository**.

## 2. Push Code to GitHub (Token Required)
GitHub no longer accepts your account password for terminal commands. You need a **Personal Access Token (PAT)**.

### Create a Token
1. Go to [GitHub Settings → Developer Settings → Personal Access Tokens → Tokens (classic)](https://github.com/settings/tokens).
2. Click **Generate new token (classic)**.
3. Name it `Biometric Deploy`.
4. Select the **repo** checkbox.
5. Click **Generate token** and **COPY IT** (you won't see it again).

### Run These Commands
In your terminal, run these:

```powershell
# 1. Clear any old remote
git remote remove origin

# 2. Add remote with your token (REPLACE <YOUR_TOKEN> with the one you copied)
git remote add origin https://<YOUR_TOKEN>@github.com/InsightfulRZ/biometric-attendance-system.git

# 3. Push the code
git branch -M main
git push -u origin main
```

## 3. Create a Cloud Database (TiDB Cloud)
1. Sign up at [TiDB Cloud](https://tidbcloud.com/).
2. Create a **Free Tier** cluster.
3. Get your **Connection String**:
   - Click **Connect** (top right) → **Connect with MySQL CLI**.
   - Copy the values for: `host`, `user`, `password`, `port`, `database`.
   - Your `DATABASE_URL` for Render will look exactly like this:
     `mysql+aiomysql://<user>:<password>@<host>:<port>/test?ssl_ca=/etc/ssl/certs/ca-certificates.crt`

## 4. Deploy to Render
1. Go to [dashboard.render.com](https://dashboard.render.com/).
2. Click **New +** → **Blueprint**.
3. Select your GitHub repo.
4. **Environment Variables**: Fill these in the Render dashboard:
   - `DATABASE_URL`: (The string you made in Step 3)
   - `ENCRYPTION_KEY`: `Mel2xydop8DG4UiwgbgrLwGAm8PoVSOYul2I5gYwRxc=`
   - `SECRET_KEY`: (Any random string, e.g., `biometric_secret_123`)

## 5. Get Your Links
Once the build is finished, Render will provide URLs for:
- **Admin Dashboard**: `https://biometric-frontend.onrender.com`
- **Backend API**: `https://biometric-backend.onrender.com`

---
> [!TIP]
> **Free Tier Sleep**: Render's free tier services "sleep" after 15 minutes of inactivity. The first request after a long time might take 30-60 seconds to wake up. This is normal for free hosting!
