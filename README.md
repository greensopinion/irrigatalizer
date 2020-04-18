## Start

```sh
$ node index.js
Server listening on port 8000...
```

## Pi Setup

### Daemon and Process Management

Install pm2:

```sh
sudo npm install pm2 -g
pm2 startup
```

Follow pm2 instructions to setup pm2 to start with systemd

#### Configure pm2

```sh
pm2 start index.js --name irrigatalizer
```

#### Handy pm2 Commands

```sh
pm2 ls
pm2 stop irrigatalizer
pm2 start irrigatalizer
pm2 save
pm2 monit
pm2 logs
```

### Networking

#### Firewall and Port 80

Redirect port 80 to port 8000 so that root access is not needed:

```sh
sudo iptables -t nat -I PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8000
```

Also see [saving-iptables-firewall-rules-permanently](https://discourse.osmc.tv/t/saving-iptables-firewall-rules-permanently/7286/7) to have that stick on reboot.

#### SSH Without Password

https://support.hostway.com/hc/en-us/articles/115001569710-Linux-Server-Access-Using-SSH-Key-without-Password
