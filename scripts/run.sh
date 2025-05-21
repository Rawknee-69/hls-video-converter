#!/bin/bash


set -e

function is_running() {
  ps -p $1 > /dev/null
  return $?
}


echo "Starting HLS Converter services..."


echo "Starting the API server..."
npm start &
SERVER_PID=$!


sleep 2


if ! is_running $SERVER_PID; then
  echo "Failed to start the API server."
  exit 1
fi

echo "API server running with PID $SERVER_PID"


echo "Starting the consumer service..."
node src/consumer.js &
CONSUMER_PID=$!

sleep 2


if ! is_running $CONSUMER_PID; then
  echo "Failed to start the consumer service."
  kill $SERVER_PID
  exit 1
fi

echo "Consumer service running with PID $CONSUMER_PID"

echo "All services started successfully!"
echo ""
echo "API server URL: http://localhost:${PORT:-3000}"
echo ""
echo "Press Ctrl+C to stop all services"

trap "echo 'Stopping services...'; kill $SERVER_PID $CONSUMER_PID; echo 'Services stopped.'" INT
wait 