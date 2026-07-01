package com.doma.security;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
public class TokenAuthFilter implements Filter {

    @Value("${doma.api-token:}")
    private String apiToken;

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
        throws IOException, ServletException {

        HttpServletRequest  request  = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        if (request.getRequestURI().startsWith("/api/v1/")) {
            if (apiToken.isBlank()) {
                response.setStatus(503);
                response.getWriter().write("{\"error\":\"DOMA_API_TOKEN이 서버에 설정되지 않았습니다.\"}");
                return;
            }
            String auth = request.getHeader("Authorization");
            if (auth == null || !auth.equals("Bearer " + apiToken)) {
                response.setStatus(401);
                response.getWriter().write("{\"error\":\"유효하지 않은 API 토큰입니다.\"}");
                return;
            }
        }

        chain.doFilter(req, res);
    }
}
