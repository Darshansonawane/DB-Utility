package com.qa.utility.config;

import com.qa.utility.security.RequestGuardFilter;
import com.qa.utility.security.SessionFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    private final AppProperties props;

    public WebConfig(AppProperties props) {
        this.props = props;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(props.corsOrigins().toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowCredentials(true)
                .allowedHeaders("*");
    }

    @Value("${qa-utility.cookie-secure:false}")
    private boolean cookieSecure;

    @Bean
    public FilterRegistrationBean<SessionFilter> sessionFilter() {
        FilterRegistrationBean<SessionFilter> reg = new FilterRegistrationBean<>(new SessionFilter(cookieSecure));
        reg.addUrlPatterns("/api/*");
        reg.setOrder(10);
        return reg;
    }

    @Bean
    public FilterRegistrationBean<RequestGuardFilter> requestGuard() {
        FilterRegistrationBean<RequestGuardFilter> reg = new FilterRegistrationBean<>(new RequestGuardFilter());
        reg.addUrlPatterns("/api/*");
        reg.setOrder(5);
        return reg;
    }
}
