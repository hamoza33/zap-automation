import paramiko

host = "35.255.81.115"
user = "aichaguimaoune"
password = "Hamza@19951995"

commands = [
    # Create an ecosystem file for PM2 that loads env vars
    """cd ~/sheet-to-tiktok-automation && cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: "sheet-to-tiktok",
    script: "dist/index.js",
    env: {
      SHEET_ID: "placeholder",
      WORKSHEET_NAME: "Sheet1",
      GOOGLE_CREDENTIALS_PATH: "/home/aichaguimaoune/sheet-to-tiktok-automation/credentials/service-account.json",
      BUFFER_ACCESS_TOKEN: "placeholder",
      BUFFER_TIKTOK_PROFILE_ID: "placeholder",
      POLLING_INTERVAL_SECONDS: "60",
      HEALTH_CHECK_PORT: "3000"
    }
  }]
}
EOF""",
    # Delete old process and start with ecosystem
    "cd ~/sheet-to-tiktok-automation && pm2 delete all 2>/dev/null; pm2 start ecosystem.config.cjs",
    "sleep 3",
    "pm2 list",
    "pm2 logs sheet-to-tiktok --lines 10 --nostream",
    "curl -s http://localhost:3000/health 2>&1 || echo 'HEALTH NOT RESPONDING'",
    "sudo ss -tlnp | grep :3000",
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=30)
print("Connected!\n")

for cmd in commands:
    print(f">>> {cmd[:100]}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(f"  {out.strip()[:500]}")
    if err.strip():
        print(f"  ERR: {err.strip()[:500]}")
    print()

client.close()
print("=== DONE ===")
