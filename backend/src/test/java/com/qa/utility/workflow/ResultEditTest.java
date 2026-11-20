package com.qa.utility.workflow;

import com.qa.utility.dto.WorkflowDtos.RunView;
import com.qa.utility.dto.WorkflowDtos.StepRunView;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.*;
import com.qa.utility.model.Workflow.*;
import com.qa.utility.repository.WorkflowRepository;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.support.AbstractDbTest;
import com.qa.utility.workflow.ResultEditService.EditRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Editing one cell of a step's result writes the change back to the row it came from, behind a preview and a confirmation token. */
class ResultEditTest extends AbstractDbTest {
    @Autowired WorkflowExecutor executor;
    @Autowired WorkflowRepository repo;
    @Autowired QueryLibraryService library;
    @Autowired ResultEditService edits;

    @BeforeEach
    void rows() {
        db.update("DELETE FROM bank_wallet.savings_wallet_contributions");
        db.update("INSERT INTO bank_wallet.savings_wallet_contributions VALUES (6651,'C1','2027-02-01'),(6648,'C1','2027-01-01')");
    }

    RunView run(String sql) {
        SavedQuery q = library.create(new SavedQuery(null, "edit" + UUID.randomUUID(), "", "T", sql, QueryType.READ, List.of(), true, List.of()));
        long id = repo.insert(new Workflow(null, "wf" + UUID.randomUUID(), "", List.of(),
                List.of(new WorkflowStep(null, 1, "rows", null, q.id(), null, List.of(), 0, 0, false, List.of(), List.of()))));
        return executor.runNow(id, Map.of(), null, null);
    }

    String contributionDate(long id) {
        return db.queryForObject("SELECT CAST(contribution_date AS VARCHAR) FROM bank_wallet.savings_wallet_contributions WHERE id = ?", String.class, id);
    }

    @Test
    void editsTheDateOfOneRowAfterPreviewAndConfirmation() {
        RunView r = run("SELECT * FROM bank_wallet.savings_wallet_contributions ORDER BY id DESC");
        assertEquals("6651", String.valueOf(r.steps().get(0).result().rows().get(0).get(0)));

        var prev = edits.preview(r.runId(), 1, new EditRequest(0, "contribution_date", "2026-12-15", null));
        assertTrue(prev.preview().executable(), String.valueOf(prev.preview().blockedReason()) + " / " + prev.preview().warnings());
        assertEquals(1L, prev.preview().affectedRows(), "only the one row identified by its key");
        assertTrue(prev.preview().sql().contains("`id` = ?"));
        assertEquals("2027-02-01", contributionDate(6651), "a preview changes nothing");

        assertThrows(ApiException.class, () -> edits.apply(r.runId(), 1, new EditRequest(0, "contribution_date", "2026-12-15", null)), "no token, no write");

        edits.apply(r.runId(), 1, new EditRequest(0, "contribution_date", "2026-12-15", prev.preview().confirmationToken()));
        assertEquals("2026-12-15", contributionDate(6651));
        assertEquals("2027-01-01", contributionDate(6648), "other rows are untouched");

        StepRunView after = executor.stepOf(r.runId(), 1);
        int col = 0;
        for (int i = 0; i < after.result().columns().size(); i++) if (after.result().columns().get(i).name().equalsIgnoreCase("contribution_date")) col = i;
        assertEquals("2026-12-15", String.valueOf(after.result().rows().get(0).get(col)), "the run's retained result shows the new value");
    }

    @Test
    void refusesWhatCannotBeIdentifiedSafely() {
        RunView noKey = run("SELECT contribution_date FROM bank_wallet.savings_wallet_contributions");
        assertThrows(ApiException.class, () -> edits.preview(noKey.runId(), 1, new EditRequest(0, "contribution_date", "2026-01-01", null)), "the key column must be in the result");

        RunView joined = run("SELECT a.* FROM bank_wallet.savings_wallet_contributions a JOIN bank_wallet.savings_wallet_details b ON b.id = a.id");
        assertThrows(ApiException.class, () -> edits.preview(joined.runId(), 1, new EditRequest(0, "contribution_date", "2026-01-01", null)), "joins are not editable");

        RunView ok = run("SELECT * FROM bank_wallet.savings_wallet_contributions");
        assertThrows(ApiException.class, () -> edits.preview(ok.runId(), 1, new EditRequest(0, "id", "1", null)), "the key itself is not editable");
        assertThrows(ApiException.class, () -> edits.preview(ok.runId(), 1, new EditRequest(0, "nope", "1", null)));
        assertThrows(ApiException.class, () -> edits.preview(ok.runId(), 1, new EditRequest(9, "contribution_date", "2026-01-01", null)));
        assertThrows(ApiException.class, () -> edits.preview(ok.runId(), 1, new EditRequest(0, "contribution_date", "not a date", null)), "the value must fit the column type");
    }
}
