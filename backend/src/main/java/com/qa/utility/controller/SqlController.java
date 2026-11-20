package com.qa.utility.controller;

import com.qa.utility.dto.SqlDtos.*;
import com.qa.utility.model.BoundParam;
import com.qa.utility.model.ParamType;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.service.SqlExecutionService;
import com.qa.utility.service.SqlExecutionService.ExecContext;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Generic SQL endpoints used by the editor: one engine, no per-query endpoints. */
@RestController
@RequestMapping("/api/sql")
public class SqlController {
    private final SqlExecutionService sql;
    private final QueryLibraryService library;

    public SqlController(SqlExecutionService sql, QueryLibraryService library) {
        this.sql = sql;
        this.library = library;
    }

    @PostMapping("/analyze")
    public SqlAnalysis analyze(@Valid @RequestBody SqlRequest r) {
        return library.analyze(r.sql());
    }

    @PostMapping("/execute")
    public QueryResult execute(@Valid @RequestBody SqlRequest r) {
        return sql.execute(r.sql(), bound(r), r.confirmationToken(), ExecContext.editor());
    }

    @PostMapping("/preview")
    public WritePreview preview(@Valid @RequestBody SqlRequest r) {
        return sql.preview(r.sql(), bound(r), ExecContext.editor());
    }

    static List<BoundParam> bound(SqlRequest r) {
        if (r.params() == null) return List.of();
        int[] i = {0};
        return r.params().stream().map(p -> new BoundParam(p.type() == null ? ParamType.STRING : p.type(), p.value(), "Parameter " + (++i[0]))).toList();
    }
}
