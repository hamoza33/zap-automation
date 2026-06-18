import paramiko

host = "35.255.81.115"
user = "aichaguimaoune"
password = "Hamza@19951995"

commands = [
    "cat /etc/caddy/Caddyfile",
    "sudo systemctl status caddy | head -20",
    "pm2 list",
    "pm2 logs sheet-to-tiktok --lines 10 --nostream",
    "curl -s http://localhost:3000/health 2>&1 || echo 'PORT 3000 NOT RESPONDING'",
    "sudo ss -tlnp | grep -E ':(80|443|3000)'",
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=30)
print("Connected!\n")

for cmd in commands:
    print(f"=== {cmd} ===")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(out.strip())
    if err.strip():
        print(f"STDERR: {err.strip()}")
    print()

client.close()
