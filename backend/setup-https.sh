#!/bin/bash
# ============================================================
# HTTPS Setup Script for WhatsApp Controller
# Installs Nginx + Let's Encrypt SSL for your VPS
# ============================================================
#
# USAGE:
#   chmod +x setup-https.sh
#   sudo ./setup-https.sh yourdomain.com your@email.com
#
# REQUIREMENTS:
#   - A domain name pointing to your VPS IP (A record)
#   - Ubuntu/Debian VPS
#   - Port 80 and 443 open in firewall
#
# This will:
#   1. Install Nginx and Certbot
#   2. Get a free SSL certificate from Let's Encrypt
#   3. Configure Nginx as a reverse proxy to your backend (port 3002)
#   4. Auto-renew SSL certificates
#   5. Enable microphone access (requires HTTPS)
# ============================================================

set -e

DOMAIN="${1}"
EMAIL="${2}"
BACKEND_PORT="${3:-3002}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "❌ Usage: sudo ./setup-https.sh yourdomain.com your@email.com [backend_port]"
  echo ""
  echo "   Example: sudo ./setup-https.sh wa.mydomain.com admin@gmail.com"
  echo "   Example: sudo ./setup-https.sh wa.mydomain.com admin@gmail.com 3002"
  exit 1
fi

echo "🔧 Setting up HTTPS for $DOMAIN → localhost:$BACKEND_PORT"
echo ""

# Install Nginx
echo "📦 Installing Nginx..."
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

# Create Nginx config
echo "📝 Creating Nginx configuration..."
cat > /etc/nginx/sites-available/$DOMAIN << NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;

        # SSE support
        proxy_buffering off;
        proxy_cache off;

        # Large file uploads (media)
        client_max_body_size 50M;
    }
}
NGINX

# Enable site
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test and reload Nginx
echo "🔍 Testing Nginx config..."
nginx -t
systemctl reload nginx

# Get SSL certificate
echo "🔐 Obtaining SSL certificate..."
certbot --nginx -d $DOMAIN --email $EMAIL --agree-tos --non-interactive --redirect

# Verify
echo ""
echo "✅ HTTPS setup complete!"
echo ""
echo "🌐 Your app is now available at: https://$DOMAIN"
echo "🎤 Microphone access is now enabled (HTTPS required)"
echo "🔄 SSL certificates will auto-renew via certbot"
echo ""
echo "📝 Next steps:"
echo "   1. Update your backend URL in the app Settings to: https://$DOMAIN"
echo "   2. Or set VITE_API_URL=https://$DOMAIN in your frontend .env"
echo ""
echo "🔧 To check certificate renewal: sudo certbot renew --dry-run"
echo "📊 To check Nginx status: sudo systemctl status nginx"
