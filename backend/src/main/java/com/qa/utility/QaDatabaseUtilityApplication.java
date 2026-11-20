package com.qa.utility;

import com.qa.utility.config.AppProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@org.springframework.scheduling.annotation.EnableScheduling
// MongoDB clients are created only by MongoAdapter (one per saved connection); Boot must not create a default localhost client.
@SpringBootApplication(exclude = org.springframework.boot.autoconfigure.mongo.MongoAutoConfiguration.class)
@EnableConfigurationProperties(AppProperties.class)
public class QaDatabaseUtilityApplication {
    public static void main(String[] args) {
        SpringApplication.run(QaDatabaseUtilityApplication.class, args);
    }
}
