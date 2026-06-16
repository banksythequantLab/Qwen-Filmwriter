# Deploy — Alibaba Cloud ECS

The backend is pure API orchestration + FFmpeg, so a small **CPU** instance is enough
(no GPU). All generation is offloaded to Qwen Cloud.

## 0. Prereqs
- An Alibaba Cloud account with hackathon credits applied.
- Your Qwen Cloud API key (from home.qwencloud.com/api-keys).

## 1. Create the ECS instance
- Region: pick one near you (Singapore matches the `dashscope-intl` endpoint well).
- Image: **Ubuntu 22.04 LTS**.
- Spec: **2 vCPU / 4 GB** (e.g. ecs.e-c1m2.large) is plenty.
- Public IP: **assign one** (needed for the demo + judging).
- Set an SSH key or password.

## 2. Security group (firewall)
Add inbound rules:
- TCP **22** (SSH) — your IP only.
- TCP **8787** (the app) — `0.0.0.0/0` for the demo, or restrict to judges if preferred.

## 3. SSH in
```
ssh root@<PUBLIC_IP>
```

## 4. Run it — pick ONE path

### Path A — Docker (recommended)
```
# install docker
curl -fsSL https://get.docker.com | sh

# get the code
git clone https://github.com/<you>/qwen-filmwriter.git
cd qwen-filmwriter

# build + run (key passed at runtime, never baked in)
docker build -t filmwriter .
docker run -d --name filmwriter -p 8787:8787 \
  -e QWEN_API_KEY="sk-..." \
  --restart unless-stopped filmwriter

docker logs -f filmwriter   # expect: "Filmwriter API on http://0.0.0.0:8787"
```

### Path B — bare Node
```
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs ffmpeg git
git clone https://github.com/<you>/qwen-filmwriter.git
cd qwen-filmwriter
echo 'QWEN_API_KEY=sk-...' > .env
echo 'QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1' >> .env
# keep it running after logout:
nohup node --env-file=.env server.mjs > server.log 2>&1 &
tail -f server.log
```

## 5. Verify (from your laptop)
```
curl http://<PUBLIC_IP>:8787/
curl -X POST http://<PUBLIC_IP>:8787/showrun \
  -H "Content-Type: application/json" \
  -d '{"logline":"a lonely android busker discovers it can dream","scenes":2}'
# -> { "jobId": "ab12cd34", ... }

curl http://<PUBLIC_IP>:8787/jobs/ab12cd34          # poll status + log
curl http://<PUBLIC_IP>:8787/jobs/ab12cd34/film -o film.mp4   # when done
```

## 6. Proof of Alibaba Cloud deployment (submission requirement)
Record a short clip (separate from the demo) that shows:
1. The ECS console / `hostname` + a command proving it's an Alibaba Cloud instance.
2. `docker logs` (or `server.log`) showing the API serving a request.
3. A successful `curl` from outside hitting the public IP.

For the required "code file demonstrating Alibaba Cloud usage," link **`lib/qwen.mjs`** —
every model call goes to `dashscope-intl.aliyuncs.com` (Alibaba Cloud / Qwen Cloud).

## Notes
- Keep the instance running through judging.
- Never commit `.env`; pass the key via `-e` or a runtime `.env` only.
- Rotate the key before the repo goes public.
