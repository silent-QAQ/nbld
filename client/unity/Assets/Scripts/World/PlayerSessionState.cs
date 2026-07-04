namespace NBLD.World
{
    public static class PlayerSessionState
    {
        public static string Token;
        public static string AccountId;
        public static string Email;
        public static string Username;
        public static string CharacterId;
        public static string CharacterName;

        public static bool IsReadyToEnterWorld =>
            !string.IsNullOrWhiteSpace(Token) &&
            !string.IsNullOrWhiteSpace(CharacterId);

        public static void Clear()
        {
            Token = null;
            AccountId = null;
            Email = null;
            Username = null;
            CharacterId = null;
            CharacterName = null;
        }
    }
