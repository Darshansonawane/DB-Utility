package com.qa.utility.project;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public final class ProjectDtos {
    private ProjectDtos() {
    }

    public record ProjectView(Long id, String name, String description, int folderCount, int workflowCount, Instant createdAt, Instant updatedAt) {
    }

    public record ProjectRequest(@NotBlank @Size(max = 120) String name, @Size(max = 1000) String description) {
    }
}
