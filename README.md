# Pi Setup

## Daemon and Process Management

Install pm2:

```
sudo npm install pm2 -g
pm2 startup
```

Follow pm2 instructions to setup pm2 to start with systemd

### Configure pm2

```
pm2 start index.js --name irrigatalizer
```

### Handy pm2 Commands

```
pm2 ls
pm2 stop irrigatalizer
pm2 start irrigatalizer
pm2 save
pm2 monit
pm2 logs
```

## Networking

Redirect port 80 to port 8000 so that root access is not needed:

```
sudo iptables -t nat -I PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8000
```
