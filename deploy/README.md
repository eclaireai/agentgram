# Deploy the agentgram Prediction API

## Option A: Railway (recommended, free tier)

1. Install Railway CLI: npm install -g @railway/cli
2. Login: railway login
3. Create project: railway init
4. Deploy: railway up
5. Set domain: railway domain
6. Set env vars:
   railway variables set AGENTGRAM_ADMIN_KEY=<your-secret>

Your API will be at: https://agentgram-api.up.railway.app

## Option B: Render (free tier)

1. Push to GitHub
2. Go to render.com → New → Web Service
3. Connect your repo
4. Render auto-detects render.yaml
5. Click Deploy

## Option C: Docker (self-hosted)

docker build -t agentgram-api .
docker run -p 3847:3847 \
  -e AGENTGRAM_ADMIN_KEY=your-secret \
  -v $(pwd)/.agentgram:/app/.agentgram \
  agentgram-api

## Option D: Fly.io

fly launch --name agentgram-api
fly deploy
fly secrets set AGENTGRAM_ADMIN_KEY=your-secret

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| PORT | No | Port to listen on (default 3847) |
| AGENTGRAM_ADMIN_KEY | Yes (prod) | Secret for creating API keys |
| NODE_ENV | No | Set to 'production' |

## After deploy

Create your first API key:
  curl -X POST https://your-api/v1/keys \
    -H "Authorization: Bearer $AGENTGRAM_ADMIN_KEY" \
    -H "Content-Type: application/json" \
    -d '{"name": "my-key", "tier": "free"}'

Test the prediction endpoint:
  curl -X POST https://your-api/v1/predict \
    -H "Authorization: Bearer agk_dev_local_only_not_for_production" \
    -H "Content-Type: application/json" \
    -d '{"task": "add stripe webhooks to nextjs"}'
