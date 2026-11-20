package com.qa.utility.support;

import com.qa.utility.model.AppSettings;
import com.qa.utility.service.SettingsService;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.UUID;

@SpringBootTest
@Import(TestTargetConfig.class)
public abstract class AbstractDbTest {
    @Autowired
    protected TestTargetConfig.MutableProvider target;
    @Autowired
    protected SettingsService settings;
    protected JdbcTemplate db;

    @BeforeEach
    void freshTargetDatabase() {
        DriverManagerDataSource ds = new DriverManagerDataSource(
                "jdbc:h2:mem:target_" + UUID.randomUUID().toString().replace("-", "")
                        + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;CASE_INSENSITIVE_IDENTIFIERS=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
        db = new JdbcTemplate(ds);
        for (String s : SCHEMA) db.execute(s);
        target.set(ds);
        settings.update(AppSettings.defaults());
    }

    protected void allowWrites() {
        settings.update(new AppSettings(false, 500, 30, 10, true, true));
    }

    private static final String[] SCHEMA = {
            "CREATE SCHEMA bank_wallet", "CREATE SCHEMA BankInstruction",
            "CREATE TABLE employee_transaction (id BIGINT PRIMARY KEY, hr_id VARCHAR(20), transaction_id VARCHAR(20), transaction_date DATE)",
            "INSERT INTO employee_transaction VALUES (1,'HR1','T1','2024-01-01'),(2,'HR1','T2','2024-01-02'),(3,'HR2','T3','2024-01-03')",
            "CREATE TABLE bank_wallet.savings_wallet_schedule (id BIGINT PRIMARY KEY, customer_id VARCHAR(20), scheduled_date DATE)",
            "CREATE TABLE bank_wallet.savings_wallet_contributors_details (id BIGINT PRIMARY KEY, savings_wallet_contributor_id VARCHAR(20), client_unique_id VARCHAR(30))",
            "CREATE TABLE BankInstruction.debit_instruction (id BIGINT PRIMARY KEY, client_unique_id VARCHAR(30), processing_date DATE, status VARCHAR(20))",
            "CREATE TABLE bank_wallet.savings_wallet_contributions (id BIGINT PRIMARY KEY, contributor_id VARCHAR(20), contribution_date DATE)",
            "CREATE TABLE BankInstruction.bank_payment_master (id BIGINT PRIMARY KEY, client_unique_id VARCHAR(30), payment_date DATE)",
            "CREATE TABLE BankInstruction.bank_payment_child (id BIGINT PRIMARY KEY, bank_payment_master_id BIGINT, payment_status VARCHAR(20))",
            "CREATE TABLE bank_wallet.savings_wallet_details (id BIGINT PRIMARY KEY, customer_id VARCHAR(20), goal_status VARCHAR(20), term_status VARCHAR(20))"
    };
}
