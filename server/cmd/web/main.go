package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

func main() {
	addr := getenv("NBLD_WEB_ADDR", ":27777")
	distDir := getenv("NBLD_WEB_DIST_DIR", "/nbld/client/web/dist")
	apiTarget := getenv("NBLD_API_TARGET", "http://127.0.0.1:6363")

	target, err := url.Parse(apiTarget)
	if err != nil {
		log.Fatalf("invalid NBLD_API_TARGET: %v", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("proxy error %s %s: %v", r.Method, r.URL.Path, err)
		http.Error(w, "api upstream unavailable", http.StatusBadGateway)
	}

	files := http.FileServer(http.Dir(distDir))
	mux := http.NewServeMux()
	mux.HandleFunc("/api/", proxy.ServeHTTP)
	mux.HandleFunc("/debug/", proxy.ServeHTTP)
	mux.HandleFunc("/healthz", proxy.ServeHTTP)
	mux.HandleFunc("/ws/", proxy.ServeHTTP)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && !strings.Contains(strings.TrimPrefix(r.URL.Path, "/"), ".") {
			http.ServeFile(w, r, distDir+"/index.html")
			return
		}
		files.ServeHTTP(w, r)
	})

	server := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("web listening on %s, dist=%s, api=%s", addr, distDir, apiTarget)
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func getenv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}
