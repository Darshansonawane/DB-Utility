package com.qa.utility.folder;

import com.qa.utility.folder.FolderDtos.*;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/folders")
public class FolderController {
    private final FolderService service;

    public FolderController(FolderService service) {
        this.service = service;
    }

    @GetMapping
    public List<Folder> list(@RequestParam String kind) {
        return service.list(kind);
    }

    @PostMapping
    public Folder create(@Valid @RequestBody CreateFolder r) {
        return service.create(r.kind(), r.parentId(), r.name());
    }

    @PutMapping("/{id}")
    public Folder update(@PathVariable long id, @Valid @RequestBody UpdateFolder r) {
        return service.update(id, r.name(), r.parentId());
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        service.delete(id);
    }
}
