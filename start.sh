#!/bin/bash

# Force Java 21 for this script session
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"

# Start the Spring Boot Backend
echo "🚀 Starting Spring Boot Backend..."
cd backend
mvn spring-boot:run &
BACKEND_PID=$!

# Navigate to Frontend and start Vite
echo "🚀 Starting Frontend (Vite)..."
cd ../frontend
npm run dev &
FRONTEND_PID=$!

# Trap Ctrl+C so it gracefully kills both processes when you stop it
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT TERM

# Keep the script running
wait