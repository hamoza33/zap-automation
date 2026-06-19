import paramiko
import time

host = "35.255.81.115"
user = "aichaguimaoune"
password = "Hamza@19951995"

commands = [
    "cd ~/sheet-to-tiktok-automation && git pull origin main",
    "cd ~/sheet-to-tiktok-automation && npm run build",
    "rm -f ~/sheet-to-tiktok-automation/processed-rows.json",
    "cd ~/sheet-to-tiktok-automation && pm2 delete sheet-to-tiktok && pm2 start ecosystem.config.cjs",
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=30)
print("Connected!\n")

for cmd in commands:
    print(f">>> {cmd[:80]}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(f"  {out.strip()[:200]}")
    print()

print("Waiting 70s for poll...")
time.sleep(70)

stdin, stdout, stderr = client.exec_command("pm2 logs sheet-to-tiktok --lines 8 --nostream", timeout=15)
logs = stdout.read().decode().strip()
print(">>> LOGS:")
print(logs)

# Check for success
if "Successfully scheduled post" in logs:
    print("\n🎉 SUCCESS! Post was scheduled via Buffer!")
elif "Failed to schedule post" in logs:
    print("\n❌ FAILED — Buffer still rejecting the request")
else:
    print("\n⏳ No post attempt visible in last 8 log lines")

client.close()
