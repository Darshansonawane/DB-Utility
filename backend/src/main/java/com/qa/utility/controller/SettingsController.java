package com.qa.utility.controller;

import com.qa.utility.model.AppSettings;
import com.qa.utility.service.SettingsService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/settings")
public class SettingsController {
    private final SettingsService service;

    public SettingsController(SettingsService service) {
        this.service = service;
    }

    @GetMapping
    public AppSettings get() {
        return service.get();
    }

    @PutMapping
    public AppSettings update(@RequestBody AppSettings s) {
        return service.update(s);
    }
}
