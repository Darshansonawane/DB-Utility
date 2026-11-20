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

    /** Needs the connection's current access password in {@code accessPassword}. */
    @PutMapping("/{id}")
    public ConnectionView update(@PathVariable long id, @Valid @RequestBody ConnectionRequest r) {
        return service.update(id, r);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id, @RequestBody(required = false) AccessRequest r) {
        service.delete(id, r == null ? null : r.accessPassword());
    }

    @PostMapping("/test")
    public TestResult testUnsaved(@Valid @RequestBody ConnectionRequest r) {
        return service.testUnsaved(r);
    }

    @PostMapping("/{id}/test")
    public TestResult test(@PathVariable long id, @RequestBody(required = false) AccessRequest r) {
        return service.testSaved(id, r == null ? null : r.accessPassword());
    }

    @PostMapping("/{id}/connect")
    public StatusView connect(@PathVariable long id, @RequestBody(required = false) AccessRequest r) {
        return service.connect(id, r == null ? null : r.accessPassword());
    }

    @PostMapping("/{id}/disconnect")
    public StatusView disconnect(@PathVariable long id) {
        return service.disconnect(id);
    }

    @PostMapping("/{id}/activate")
    public StatusView activate(@PathVariable long id) {
        return service.activate(id);
    }

    @PostMapping("/{id}/access-password")
    public ConnectionView setAccessPassword(@PathVariable long id, @RequestBody SetAccessPasswordRequest r) {
        return service.setAccessPassword(id, r.newAccessPassword());
    }

    /** Disconnects every connection of this browser session. */
    @PostMapping("/disconnect")
    public StatusView disconnectAll() {
        return service.disconnectAll();
    }

    /** Active MySQL connection (the one queries and workflows use). */
    @GetMapping("/status")
    public StatusView status() {
        return service.status();
    }

    /** Independent health of every live connection of this session (MySQL and MongoDB). */
    @GetMapping("/statuses")
    public List<StatusView> statuses() {
        return service.statuses();
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
