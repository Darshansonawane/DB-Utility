package com.qa.utility.controller;

import com.qa.utility.dto.SqlDtos.QueryResult;
import com.qa.utility.dto.SqlDtos.WritePreview;
import com.qa.utility.model.SavedQuery;
import com.qa.utility.service.QueryLibraryService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/queries")
public class QueryController {
    public record ExecuteBody(Map<String, String> values, String confirmationToken) {
    }

    private final QueryLibraryService service;
    private final com.qa.utility.folder.FolderService folders;

    public QueryController(QueryLibraryService service, com.qa.utility.folder.FolderService folders) {
        this.service = service;
        this.folders = folders;
    }

    @GetMapping
    public List<SavedQuery> search(@RequestParam(required = false) String q, @RequestParam(required = false) String category) {
        return service.search(q, category);
    }

    public record MoveBody(Long folderId) {
    }

    /** query id -> folder id for queries filed in a folder; the rest are Unfiled. */
    @GetMapping("/folders")
    public java.util.Map<Long, Long> folderAssignments() {
        return service.folderAssignments();
    }

    @PutMapping("/{id}/folder")
    public void move(@PathVariable long id, @RequestBody MoveBody b) {
        service.moveToFolder(id, folders.requireFolder("QUERY", b.folderId()));
    }

    @GetMapping("/categories")
    public List<String> categories() {
        return service.categories();
    }

    @GetMapping("/{id}")
    public SavedQuery get(@PathVariable long id) {
        return service.get(id);
    }

    @PostMapping
    public SavedQuery create(@Valid @RequestBody SavedQuery q) {
        return service.create(q);
    }

    @PutMapping("/{id}")
    public SavedQuery update(@PathVariable long id, @Valid @RequestBody SavedQuery q) {
        return service.update(id, q);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        service.delete(id);
    }

    @PostMapping("/{id}/duplicate")
    public SavedQuery duplicate(@PathVariable long id) {
        return service.duplicate(id);
    }

    @PostMapping("/{id}/enabled")
    public SavedQuery enabled(@PathVariable long id, @RequestParam boolean value) {
        return service.setEnabled(id, value);
    }

    /** Shows what each parameter would be bound to (variables resolved, secrets masked) without executing anything. */
    @PostMapping("/{id}/resolve")
    public List<QueryLibraryService.ParamPreview> resolve(@PathVariable long id, @RequestBody ExecuteBody b) {
        return service.previewParams(id, b.values());
    }

    @PostMapping("/{id}/preview")
    public WritePreview preview(@PathVariable long id, @RequestBody ExecuteBody b) {
        return service.preview(id, b.values());
    }

    @PostMapping("/{id}/execute")
    public QueryResult execute(@PathVariable long id, @RequestBody ExecuteBody b) {
        return service.execute(id, b.values(), b.confirmationToken());
    }
}
