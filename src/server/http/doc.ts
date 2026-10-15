/** Endpoint discovery metadata the gateway catalogue requires (contract SS-27). */
export interface OperationDoc {
  name: string;
  purpose: string;
  use_when: string[];
  do_not_use_when: string[];
  inputs: string[];
  outputs: string[];
  requires: string[];
  related_endpoints: string[];
  tags: string[];
}

export function op(
  name: string, purpose: string, useWhen: string[], doNotUseWhen: string[],
  inputs: string[], outputs: string[], requires: string[], related: string[], tags: string[],
): OperationDoc {
  return { name, purpose, use_when: useWhen, do_not_use_when: doNotUseWhen, inputs, outputs, requires, related_endpoints: related, tags };
}
