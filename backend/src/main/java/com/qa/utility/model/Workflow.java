package com.qa.utility.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

public record Workflow(
        Long id,
        @NotBlank @Size(max = 200) String name,
        @Size(max = 1000) String description,
        @Valid List<WorkflowInput> inputs,
        @Valid List<WorkflowStep> steps,
        Long folderId) {

    /** Backward-compatible constructor: top level (no folder). */
    public Workflow(Long id, String name, String description, List<WorkflowInput> inputs, List<WorkflowStep> steps) {
        this(id, name, description, inputs, steps, null);
    }

    public Workflow {
        inputs = inputs == null ? List.of() : inputs;
        steps = steps == null ? List.of() : steps;
    }

    public record WorkflowInput(
            @NotBlank @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]{0,99}$") String name,
            @NotBlank String label,
            @NotNull ParamType type,
            boolean required) {
    }

    public enum SourceType { INPUT, STEP_OUTPUT, CONSTANT }

    public record ParamMapping(
            @NotBlank String paramName,
            @NotNull SourceType sourceType,
            String sourceRef,
            String sourceField,
            String constantValue) {
    }

    /** alias is the name other steps use; column is read from the first row of this step's result. */
    public record OutputField(@NotBlank String alias, @NotBlank String column) {
    }

    public record WorkflowStep(
            Long id,
            int order,
            @NotBlank String name,
            String description,
            long queryId,
            String queryName,
            List<Integer> dependsOn,
            int retryCount,
            int retryDelayMs,
            boolean stopOnFailure,
            @Valid List<OutputField> outputFields,
            @Valid List<ParamMapping> mappings,
            String stepType,
            Long apiRequestId,
            String apiRequestName,
            @Valid com.qa.utility.automation.ApiDtos.ApiStepOptions apiOptions,
            Long subWorkflowId,
            String subWorkflowName) {
        public static final String QUERY = "QUERY";
        public static final String API_REQUEST = "API_REQUEST";
        public static final String WORKFLOW = "WORKFLOW";

        public WorkflowStep(Long id, int order, String name, String description, long queryId, String queryName, List<Integer> dependsOn,
                            int retryCount, int retryDelayMs, boolean stopOnFailure, List<OutputField> outputFields, List<ParamMapping> mappings,
                            String stepType, Long apiRequestId, String apiRequestName, com.qa.utility.automation.ApiDtos.ApiStepOptions apiOptions) {
            this(id, order, name, description, queryId, queryName, dependsOn, retryCount, retryDelayMs, stopOnFailure, outputFields, mappings,
                    stepType, apiRequestId, apiRequestName, apiOptions, null, null);
        }

        public boolean isWorkflow() {
            return WORKFLOW.equals(stepType);
        }

        /** Backward-compatible constructor for DB-query steps. */
        public WorkflowStep(Long id, int order, String name, String description, long queryId, String queryName, List<Integer> dependsOn,
                            int retryCount, int retryDelayMs, boolean stopOnFailure, List<OutputField> outputFields, List<ParamMapping> mappings) {
            this(id, order, name, description, queryId, queryName, dependsOn, retryCount, retryDelayMs, stopOnFailure, outputFields, mappings,
                    QUERY, null, null, null, null, null);
        }

        public boolean isApi() {
            return API_REQUEST.equals(stepType);
        }

        public WorkflowStep {
            stepType = API_REQUEST.equalsIgnoreCase(stepType) ? API_REQUEST : WORKFLOW.equalsIgnoreCase(stepType) ? WORKFLOW : QUERY;
            dependsOn = dependsOn == null ? List.of() : dependsOn;
            outputFields = outputFields == null ? List.of() : outputFields;
            mappings = mappings == null ? List.of() : mappings;
        }
    }
}
