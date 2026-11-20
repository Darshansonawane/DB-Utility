package com.qa.utility.workflow;

import com.qa.utility.model.*;
import com.qa.utility.model.Workflow.*;
import com.qa.utility.repository.SavedQueryRepository;
import com.qa.utility.repository.WorkflowRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Seeds the seven SELECT queries and the Savings Wallet workflow supplied by the QA engineer, once, if absent.
 * The SQL is verbatim. Only the output-column aliases (client_unique_id, id) are assumptions; they are editable
 * in Workflow Manager and overridable per run.
 */
@Component
public class SavingsWalletSeeder implements ApplicationRunner {
    public static final String WORKFLOW_NAME = "Savings Wallet - Schedule & Payment Data Manager";
    private static final Logger log = LoggerFactory.getLogger(SavingsWalletSeeder.class);
    private static final String CAT = "Savings Wallet";

    private final SavedQueryRepository queries;
    private final WorkflowRepository workflows;

    public SavingsWalletSeeder(SavedQueryRepository queries, WorkflowRepository workflows) {
        this.queries = queries;
        this.workflows = workflows;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (workflows.findByName(WORKFLOW_NAME).isPresent()) return;
        long q1 = query("SW 1 - Fetch savings wallet schedule", "Schedule rows for a customer, newest first. No date filter: the one-month-back filter awaits schema confirmation.",
                "SELECT sws.*\nFROM bank_wallet.savings_wallet_schedule AS sws\nWHERE customer_id = ?\nORDER BY sws.id DESC", p("customer_id", "Customer ID"));
        long q2 = query("SW 2 - Fetch contributor details", "Contributor details including the client unique ID.",
                "SELECT swcd.*\nFROM bank_wallet.savings_wallet_contributors_details AS swcd\nWHERE savings_wallet_contributor_id = ?", p("savings_wallet_contributor_id", "Savings Wallet Contributor ID"));
        long q3 = query("SW 3 - Fetch debit instruction", "Debit instruction for a client unique ID (read only; no date is changed).",
                "SELECT di.*\nFROM BankInstruction.debit_instruction AS di\nWHERE client_unique_id = ?", p("client_unique_id", "Client Unique ID"));
        long q4 = query("SW 4 - Fetch savings wallet contributions", "Contributions for a contributor.",
                "SELECT swc.*\nFROM bank_wallet.savings_wallet_contributions AS swc\nWHERE contributor_id = ?", p("contributor_id", "Contributor ID"));
        long q5 = query("SW 5 - Fetch payment master", "Bank payment master rows for a client unique ID.",
                "SELECT bpm.*\nFROM BankInstruction.bank_payment_master AS bpm\nWHERE client_unique_id = ?", p("client_unique_id", "Client Unique ID"));
        long q6 = query("SW 6 - Fetch payment child", "Payment child rows (verify whether payment completed).",
                "SELECT bpc.*\nFROM BankInstruction.bank_payment_child AS bpc\nWHERE bank_payment_master_id = ?", p("bank_payment_master_id", "Bank Payment Master ID"));
        long q7 = query("SW 7 - Fetch savings wallet details", "Wallet details (goal status, term status).",
                "SELECT swd.*\nFROM bank_wallet.savings_wallet_details AS swd\nWHERE swd.customer_id = ?", p("customer_id", "Customer ID"));

        List<WorkflowInput> inputs = List.of(
                new WorkflowInput("customerId", "Customer ID", ParamType.STRING, true),
                new WorkflowInput("contributorId", "Savings Wallet Contributor ID", ParamType.STRING, true));
        List<WorkflowStep> steps = List.of(
                step(1, "Fetch savings wallet schedule", q1, List.of(), "scheduleId=id", map("customer_id", SourceType.INPUT, "customerId", null)),
                step(2, "Fetch contributor details", q2, List.of(), "clientUniqueId=client_unique_id", map("savings_wallet_contributor_id", SourceType.INPUT, "contributorId", null)),
                step(3, "Fetch debit instruction", q3, List.of(2), "", map("client_unique_id", SourceType.STEP_OUTPUT, "2", "clientUniqueId")),
                step(4, "Fetch savings wallet contributions", q4, List.of(), "", map("contributor_id", SourceType.INPUT, "contributorId", null)),
                step(5, "Fetch payment master", q5, List.of(2), "paymentMasterId=id", map("client_unique_id", SourceType.STEP_OUTPUT, "2", "clientUniqueId")),
                step(6, "Fetch payment child", q6, List.of(5), "", map("bank_payment_master_id", SourceType.STEP_OUTPUT, "5", "paymentMasterId")),
                step(7, "Fetch savings wallet details", q7, List.of(), "", map("customer_id", SourceType.INPUT, "customerId", null)));
        workflows.insert(new Workflow(null, WORKFLOW_NAME, "Fetch schedule, contributor, debit instruction, contributions, payment master/child and wallet details for one test case.", inputs, steps));
        log.info("Seeded Savings Wallet workflow with 7 read-only queries");
    }

    private static QueryParameter p(String name, String label) {
        return new QueryParameter(name, label, ParamType.STRING, true, null);
    }

    private long query(String name, String desc, String sql, QueryParameter param) {
        return queries.findByName(name).map(SavedQuery::id).orElseGet(() ->
                queries.insert(new SavedQuery(null, name, desc, CAT, sql, QueryType.READ, List.of(), true, List.of(param))));
    }

    private static ParamMapping map(String param, SourceType t, String ref, String field) {
        return new ParamMapping(param, t, ref, field, null);
    }

    private static WorkflowStep step(int order, String name, long queryId, List<Integer> deps, String outputs, ParamMapping mapping) {
        List<OutputField> outs = new java.util.ArrayList<>();
        for (String o : outputs.split(",")) {
            if (o.isBlank()) continue;
            String[] kv = o.split("=");
            outs.add(new OutputField(kv[0], kv[1]));
        }
        return new WorkflowStep(null, order, name, null, queryId, null, deps, 0, 500, false, outs, List.of(mapping));
    }
}
