import paramiko

host = "35.255.81.115"
user = "aichaguimaoune"
password = "Hamza@19951995"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=30)

stdin, stdout, stderr = client.exec_command("pm2 logs sheet-to-tiktok --lines 15 --nostream", timeout=15)
print(stdout.read().decode().strip())

print("\n---")
stdin, stdout, stderr = client.exec_command("cat ~/sheet-to-tiktok-automation/processed-rows.json 2>/dev/null || echo 'NO FILE'", timeout=5)
print("processed-rows.json:", stdout.read().decode().strip())

client.close()
