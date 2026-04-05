### Issue: Update Advisory Council System to Support Domain-Specific Configuration

#### Description
We need to enhance the Advisory Council system in the Anima repository to support more granular domain-specific configurations. This update aims to ensure that recipes and workflows can dynamically utilize the council advisers that are most relevant to the specific task or domain being executed.

#### Requirements
1. **Adviser Specification**: Recipes/workflows should have the capability to specify their required or recommended council advisers based on the domain or task being performed.
2. **Dynamic Selection**: There should be a mechanism for dynamically selecting or composing the council at runtime, depending on the workflow being executed.
3. **Adviser Profiles**: Implement mechanisms for loading and maintaining profiles, roles, and prompts for domain advisers.
4. **Configuration Documentation**: Clear documentation should be provided that outlines how to define new advisers or associate existing ones with specific domains.
5. **Seamless Integration**: Integration with the existing workflow/recipe and intent mapping systems must be seamless and intuitive.
6. **Efficiency and Compliance Guidelines**: Establish guidelines to ensure that the council review process is efficient, avoiding excessive review steps while also adhering to security and compliance protocols.
7. **Example Configurations**: Provide example configurations and necessary test cases that illustrate how to implement these new features effectively.

#### Expected Outcomes
- Improved flexibility and specificity in council adviser assignments.
- Enhanced operational efficiency during workflow execution.
- Comprehensive documentation and guidelines for future users and developers.

Created on: 2026-04-05 13:52:56 UTC
Reported by: Heather-Herbert