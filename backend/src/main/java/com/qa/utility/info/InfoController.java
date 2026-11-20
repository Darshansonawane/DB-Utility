package com.qa.utility.info;

import com.qa.utility.folder.FolderDtos.MoveItem;
import com.qa.utility.info.InfoDtos.InfoItem;
import com.qa.utility.info.InfoDtos.InfoSummary;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/info")
public class InfoController {
    private final InfoService service;

    public InfoController(InfoService service) {
        this.service = service;
    }

    @GetMapping("/items")
    public List<InfoSummary> list(@RequestParam(required = false) String q) {
        return service.list(q);
    }

    @GetMapping("/items/{id}")
    public InfoItem get(@PathVariable long id) {
        return service.get(id);
    }

    @PostMapping("/items")
    public InfoItem create(@Valid @RequestBody InfoItem i) {
        return service.save(null, i);
    }

    @PutMapping("/items/{id}")
    public InfoItem update(@PathVariable long id, @Valid @RequestBody InfoItem i) {
        return service.save(id, i);
    }

    @PutMapping("/items/{id}/folder")
    public void move(@PathVariable long id, @RequestBody MoveItem b) {
        service.move(id, b.folderId());
    }

    @DeleteMapping("/items/{id}")
    public void delete(@PathVariable long id) {
        service.delete(id);
    }
}
