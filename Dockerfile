FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Folder data (database SQLite) harus disimpan di volume persisten oleh platform hosting,
# supaya HPP tidak hilang tiap kali di-deploy ulang. Lihat README untuk detail per platform.
VOLUME ["/app/data"]

# Versi yang tampil di /api/kesehatan: diisi deploy-site.ps1 lewat build arg (MARGIN_COMMIT di compose juserver)
ARG GIT_COMMIT=lokal
ENV GIT_COMMIT=$GIT_COMMIT

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
