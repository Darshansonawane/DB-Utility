package com.qa.utility.controller;

import com.qa.utility.exception.ApiException;
import com.qa.utility.repository.ConnectionProfileRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Map;

/**
 * Convenience only: launches the VPN client app on this Mac and checks whether a SAVED profile's host:port is reachable.
 * It does not hold VPN credentials and cannot sign in for you; you still log in / approve MFA in the VPN client.
 */
@RestController
@RequestMapping("/api/vpn")
public class VpnController {
    private final ConnectionProfileRepository profiles;
    private final String appName;

    public VpnController(ConnectionProfileRepository profiles, @Value("${qa-utility.vpn-app-name:FortiClient}") String appName) {
        this.profiles = profiles;
        this.appName = appName;
    }

    @PostMapping("/open")
    public Map<String, Object> open() {
        if (!appName.matches("[A-Za-z0-9 ._-]{1,60}")) throw ApiException.badRequest("Invalid VPN app name configured");
        try {
            Process p = new ProcessBuilder("open", "-a", appName).redirectErrorStream(true).start();
            int code = p.waitFor();
            if (code != 0) throw ApiException.badRequest("Could not open '" + appName + "'. Set qa-utility.vpn-app-name to the exact app name.");
            return Map.of("opened", true, "app", appName);
        } catch (java.io.IOException | InterruptedException e) {
            throw ApiException.badRequest("Could not launch VPN app: " + e.getMessage());
        }
    }

    @GetMapping("/reachable/{profileId}")
    public Map<String, Object> reachable(@PathVariable long profileId) {
        var p = profiles.findById(profileId).orElseThrow(() -> ApiException.notFound("Connection profile not found"));
        long start = System.currentTimeMillis();
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(p.host(), p.port()), 3000);
            return Map.of("reachable", true, "ms", System.currentTimeMillis() - start);
        } catch (java.io.IOException e) {
            return Map.of("reachable", false, "message", "Cannot reach " + p.host() + ":" + p.port() + " (is the VPN connected?)");
        }
    }
}
