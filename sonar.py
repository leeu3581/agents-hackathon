import os
from dotenv import load_dotenv
import requests
import json
from typing import List, Dict, Optional

class DeepseekSonar:
    def __init__(self, api_key: Optional[str] = None):
        """Initialize the DeepseekSonar client.
        
        Args:
            api_key: Deepseek API key. If not provided, will try to get from environment variable.
        """
        # Load environment variables from .env file
        load_dotenv()
        
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY")
        self.base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
        
        if not self.api_key:
            raise ValueError("Deepseek API key must be provided or set in DEEPSEEK_API_KEY environment variable")
        
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def search_references(self, query: str, max_results: int = 5) -> List[Dict]:
        """Search for references using Deepseek Chat API.
        
        Args:
            query: The search query string
            max_results: Maximum number of results to return
        """
        endpoint = f"{self.base_url}/v1/chat/completions"
        
        # Updated prompt for general sources
        prompt = f"""Find {max_results} relevant sources related to: {query}

Include a mix of different source types like:
- Blog posts
- News articles
- Technical documentation
- Research papers
- Forum discussions
- Video content
- Industry reports

Please format your response as a valid JSON array where each item has this exact structure:
{{
    "title": "exact title of the source",
    "authors": ["author1 name", "author2 name"],
    "year": "YYYY",
    "type": "blog|article|paper|video|documentation|report|discussion",
    "summary": "brief summary of the content",
    "url": "source url"
}}

Return ONLY the JSON array with no additional text or formatting."""

        payload = {
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": "You are a helpful research assistant. Always respond with valid JSON arrays."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.1
        }

        try:
            response = requests.post(
                endpoint,
                headers=self.headers,
                json=payload
            )
            response.raise_for_status()
            
            # Parse the response content as JSON
            chat_response = response.json()
            content = chat_response['choices'][0]['message']['content'].strip()
            
            # Clean up the content to ensure it's valid JSON
            content = content.replace('\n', ' ').strip()
            if not content.startswith('['):
                content = content[content.find('['):]
            if not content.endswith(']'):
                content = content[:content.rfind(']')+1]
            
            # Extract the JSON array from the response
            try:
                results = json.loads(content)
                if not isinstance(results, list):
                    print("Response was not a JSON array")
                    return []
                return results
            except json.JSONDecodeError as e:
                print(f"Failed to parse results as JSON: {str(e)}")
                print(f"Raw content: {content}")
                return []
            
        except requests.exceptions.RequestException as e:
            print(f"Error making request to Deepseek API: {str(e)}")
            if hasattr(e, 'response') and hasattr(e.response, 'text'):
                print(f"Response details: {e.response.text}")
            return []

def main():
    # Example usage
    sonar = DeepseekSonar()
    
    query = "find the original tweet about Vitalik having a girlfriend"
    results = sonar.search_references(query)
    
    for idx, result in enumerate(results, 1):
        print(f"\nResult {idx}:")
        print(f"Title: {result.get('title', 'N/A')}")
        print(f"Type: {result.get('type', 'N/A')}")
        print(f"Authors: {', '.join(result.get('authors', []))}")
        print(f"Year: {result.get('year', 'N/A')}")
        print(f"Summary: {result.get('summary', 'N/A')}")
        print(f"URL: {result.get('url', 'N/A')}")

if __name__ == "__main__":
    main()
