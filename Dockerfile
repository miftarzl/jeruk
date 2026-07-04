# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy model files
COPY model_jeruk_tfjs/ ./model_jeruk_tfjs/

# Production stage - Nginx
FROM nginx:alpine

# Copy nginx configuration
RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy web files
COPY index.html /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
COPY style.css /usr/share/nginx/html/
COPY --from=builder /app/model_jeruk_tfjs/ /usr/share/nginx/html/model_jeruk_tfjs/

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
