package com.qa.utility.controller;

import com.qa.utility.service.MetadataService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/metadata")
public class MetadataController {
    private final MetadataService service;

    public MetadataController(MetadataService service) {
        this.service = service;
    }

    @GetMapping("/schemas")
    public List<String> schemas() {
        return service.schemas();
    }

    @GetMapping("/schemas/{schema}/tables")
    public List<Map<String, Object>> tables(@PathVariable String schema) {
        return service.tables(schema);
    }

    @GetMapping("/schemas/{schema}/tables/{table}")
    public Map<String, Object> table(@PathVariable String schema, @PathVariable String table) {
        return service.table(schema, table);
    }

    @GetMapping("/schemas/{schema}/tables/{table}/columns/{column}/values")
    public List<Map<String, Object>> distinct(@PathVariable String schema, @PathVariable String table, @PathVariable String column) {
        return service.distinct(schema, table, column);
    }

    @GetMapping("/schemas/{schema}/tables/{table}/sample")
    public List<Map<String, Object>> sample(@PathVariable String schema, @PathVariable String table, @RequestParam(defaultValue = "10") int limit) {
        return service.sample(schema, table, limit);
    }
}
