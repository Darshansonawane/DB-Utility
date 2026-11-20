package com.qa.utility.controller;

import com.qa.utility.dto.SqlDtos.SqlAnalysis;
import com.qa.utility.service.MongoExecutionService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/mongo")
public class MongoController {
    public record AnalyzeRequest(@jakarta.validation.constraints.NotBlank String query) {
    }

    private final MongoExecutionService mongo;

    public MongoController(MongoExecutionService mongo) {
        this.mongo = mongo;
    }

    /** Validates a MongoDB JSON query spec and suggests one form parameter per "?". */
    @PostMapping("/analyze")
    public SqlAnalysis analyze(@Valid @RequestBody AnalyzeRequest r) {
        return mongo.analyze(r.query());
    }

    @GetMapping("/collections")
    public List<String> collections(@RequestParam(required = false) String database) {
        return mongo.collections(database);
    }
}
