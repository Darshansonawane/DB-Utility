package com.qa.utility.controller;

import com.qa.utility.dto.ConnectionDtos.*;
import com.qa.utility.service.ConnectionService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/connections")
public class ConnectionController {
    private final ConnectionService service;

    public ConnectionController(ConnectionService service) {
        this.service = service;
    }

    @GetMapping
    public List<ConnectionView> list() {
        return service.list();
    }

    @PostMapping
    public ConnectionView create(@Valid @RequestBody ConnectionRequest r) {
        return service.create(r);
    }

    @PutMapping("/{id}")
    public ConnectionView update(@PathVariable long id, @Valid @RequestBody ConnectionRequest r) {
        return service.update(id, r);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        service.delete(id);
    }

    @PostMapping("/test")
    public TestResult testUnsaved(@Valid @RequestBody ConnectionRequest r) {
        return service.testUnsaved(r);
    }

    @PostMapping("/{id}/test")
    public TestResult test(@PathVariable long id) {
        return service.testSaved(id);
    }

    @PostMapping("/{id}/connect")
    public StatusView connect(@PathVariable long id) {
        return service.connect(id);
    }

    @PostMapping("/disconnect")
    public StatusView disconnect() {
        return service.disconnect();
    }

    @GetMapping("/status")
    public StatusView status() {
        return service.status();
    }

    @GetMapping("/databases")
    public DatabaseList databases() {
        return service.databases();
    }

    @PostMapping("/database")
    public StatusView useDatabase(@Valid @RequestBody UseDatabaseRequest r) {
        return service.useDatabase(r.name());
    }
}
