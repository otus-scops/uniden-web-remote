FROM node:20-slim

# Install required packages
# sox: Audio recording and processing
# libsox-fmt-mp3: SoX MP3 encoding support
# alsa-utils: ALSA audio device utilities (arecord, aplay, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    sox \
    libsox-fmt-mp3 \
    alsa-utils \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Working directory
WORKDIR /app

# Copy application source code
COPY . .

# Remove existing host node_modules and perform clean production install
RUN rm -rf node_modules && npm install --omit=dev

# Create directories for recordings and config
RUN mkdir -p /app/recordings /app/config

# Expose web server port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/status || exit 1

# Entrypoint
CMD ["node", "src/server.js"]
