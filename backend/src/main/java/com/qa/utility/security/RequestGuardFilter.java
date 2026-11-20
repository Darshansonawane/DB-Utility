package com.qa.utility.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * The API only listens on 127.0.0.1, and CORS only allows the local frontend origin. As a further CSRF defence,
 * every state-changing or data-reading API call must carry a custom header, which a foreign web page cannot
 * add to a cross-origin request without a CORS pre-flight that the server refuses.
 */
public class RequestGuardFilter extends OncePerRequestFilter {
    public static final String HEADER = "X-QA-Utility";

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        if ("OPTIONS".equalsIgnoreCase(req.getMethod()) || req.getHeader(HEADER) != null) {
            chain.doFilter(req, res);
            return;
        }
        res.setStatus(HttpServletResponse.SC_FORBIDDEN);
        res.setContentType("application/json");
        res.getWriter().write("{\"error\":\"Missing required header " + HEADER + "\"}");
    }
}
