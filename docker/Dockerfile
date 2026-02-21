# Dockerfile - static site with nginx
FROM nginx:1.29.5-alpine

# Create non-root user (simple & safer)
RUN adduser -D -H -s /sbin/nologin webuser

# Set non-root user permissions
RUN chown -R webuser:webuser /usr/share/nginx/html

# Copy custom nginx config (see nginx.conf below)
COPY nginx.conf /etc/nginx/nginx.conf

# Clean default nginx content
RUN rm -rf /usr/share/nginx/html/*

# Copy website into default nginx web root
COPY ../public/ /usr/share/nginx/html/

# Copy entrypoint script to image
COPY entrypoint.sh /entrypoint.sh

# Make entrypoint executable
RUN chmod +x /entrypoint.sh

# Install curl for healthcheck
RUN apk add --no-cache curl

# Document that the container listens on port 80
EXPOSE 80

# Healthcheck to ensure nginx is serving content
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD curl -f http://localhost/ || exit 1

# Start nginx using the custom entrypoint to set env vars
ENTRYPOINT ["/entrypoint.sh"]