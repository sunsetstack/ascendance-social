# -- Build stage
FROM node:24.13.0-alpine AS builder
WORKDIR /app

# Copy root package files and each workspace package.json so npm knows the workspaces
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install ALL dependencies including dev deps (needed for tsc)
RUN npm ci --include=dev

# Copy rest of the sources
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/
COPY tsconfig.base.json ./

# Build the specific workspace
RUN cd backend && npm run build

# -- Production stage
FROM node:24.13.0-alpine
WORKDIR /app

# Create a non-root user
RUN addgroup -g 1001 -S nodejs && \
  adduser -S nodejs -u 1001

# Copy the root package files again
COPY package.json package-lock.json ./

# Copy the package.json files for each workspace so npm knows what to install
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install ONLY production dependencies for all workspaces
RUN npm ci --omit=dev

# Copy compiled code with ownership
COPY --from=builder --chown=nodejs:nodejs /app/backend/dist ./backend/dist

# Create uploads directory and give nodejs user ownership of necessary directories
RUN mkdir -p /app/uploads /app/audit/logs /app/audit/archives && \
  chown -R nodejs:nodejs /app/uploads /app/audit /app/backend

# Switch to non-root user
USER nodejs

EXPOSE 3000

# The command must now point to the correct path within the container
CMD ["node", "backend/dist/main.js"]
