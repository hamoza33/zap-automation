import paramiko

host = "35.255.81.115"
user = "aichaguimaoune"
password = "Hamza@19951995"

commands = [
    "pm2 logs sheet-to-tiktok --lines 20 --nostream",
]

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=30)

for cmd in commands:
    print(f">>> {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(out.strip())
    if err.strip():
        print(f"ERR: {err.strip()}")

client.close()
