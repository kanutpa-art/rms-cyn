FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p data uploads/slips uploads/maintenance uploads/inspections
EXPOSE 3000
CMD ["node", "server.js"]
