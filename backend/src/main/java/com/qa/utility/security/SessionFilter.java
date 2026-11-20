package com.qa.utility.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.regex.Pattern;

/** Issues and reads the anonymous HttpOnly session cookie and binds it to the request thread. No credentials, no tokens in JavaScript. */
public class SessionFilter extends OncePerRequestFilter {
    public static final String COOKIE = "QA_SID";
    private static final Pattern VALID = Pattern.compile("^[A-Za-z0-9_-]{22,64}$");
    private static final SecureRandom RANDOM = new SecureRandom();
    private final boolean secure;

    public SessionFilter(boolean secure) {
        this.secure = secure;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        String sid = null;
        if (req.getCookies() != null) {
            for (Cookie c : req.getCookies()) if (COOKIE.equals(c.getName()) && VALID.matcher(c.getValue()).matches()) sid = c.getValue();
        }
        if (sid == null) {
            byte[] b = new byte[24];
            RANDOM.nextBytes(b);
            sid = Base64.getUrlEncoder().withoutPadding().encodeToString(b);
            res.addHeader("Set-Cookie", COOKIE + "=" + sid + "; Path=/; HttpOnly; SameSite=Strict" + (secure ? "; Secure" : ""));
        }
        SessionContext.set(sid);
        try {
            chain.doFilter(req, res);
        } finally {
            SessionContext.clear();
        }
    }
}
