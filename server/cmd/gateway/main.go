package main

import (
	"log"
	"os"

	"nbld/server/internal/app"
)

func main() {
	addr := os.Getenv("NBLD_GATEWAY_ADDR")
	if addr == "" {
		addr = ":6363"
	}

	instanceID := os.Getenv("NBLD_INSTANCE_ID")
	if instanceID == "" {
		instanceID = "local-dev"
	}

	server := app.NewServer(addr, instanceID)
	if err := server.Run(); err != nil {
		log.Fatal(err)
	}
}
