# FieldOps — Linux production image (Expo web build + nginx)
# Build: docker build -f linux/Dockerfile -t fieldops:linux .
# Run: docker run -p 8080:80 fieldops:linux
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Expo web export (requires react-native-web)
RUN npx expo export --platform web --output-dir dist || npx expo export:web

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# SPA fallback: try index.html for expo-router routes
RUN printf 'server { listen 80; root /usr/share/nginx/html; index index.html; location / { try_files $uri $uri/ /index.html; } }\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
