package com.qa.utility.project;

import com.qa.utility.project.ProjectDtos.ProjectRequest;
import com.qa.utility.project.ProjectDtos.ProjectView;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {
    private final ProjectService service;

    public ProjectController(ProjectService service) {
        this.service = service;
    }

    @GetMapping
    public List<ProjectView> list() {
        return service.list();
    }

    @GetMapping("/{id}")
    public ProjectView get(@PathVariable long id) {
        return service.get(id);
    }

    @PostMapping
    public ProjectView create(@Valid @RequestBody ProjectRequest r) {
        return service.create(r);
    }

    @PutMapping("/{id}")
    public ProjectView update(@PathVariable long id, @Valid @RequestBody ProjectRequest r) {
        return service.update(id, r);
    }

    /** A non-empty project needs {@code moveTo}: the project that receives its folders and workflows. */
    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id, @RequestParam(required = false) Long moveTo) {
        service.delete(id, moveTo);
    }
}
